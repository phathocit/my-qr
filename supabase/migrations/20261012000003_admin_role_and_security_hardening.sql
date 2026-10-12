-- Migration: Admin Role Verification, Granular Grants & Storage Hardening
-- Up migration: 20261012000003_admin_role_and_security_hardening.sql
-- Mục đích: Bổ sung cơ chế quản trị viên tập trung, siết Storage policies và RPC functions,
--          thu hồi quyền truy cập từ role anon và đánh dấu theo dõi migration đã áp dụng.
-- KHÔNG xóa dữ liệu hiện có, KHÔNG yêu cầu chạy lại migration 1 và 2.

-- ========================================================
-- 1. BẢNG THEO DÕI MIGRATION (TRÁNH CHẠY LẶP)
-- ========================================================

CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read schema_migrations" ON public.schema_migrations;
CREATE POLICY "Allow read schema_migrations" ON public.schema_migrations
    FOR SELECT TO authenticated USING (true);

-- Ghi nhận 2 migration trước đó đã hoàn tất áp dụng trên Cloud
INSERT INTO public.schema_migrations (version, name)
VALUES 
    ('20261012000000', 'initial_schema'),
    ('20261012000001', 'warranty_rpcs'),
    ('20261012000002', 'security_hardening')
ON CONFLICT (version) DO NOTHING;

-- ========================================================
-- 2. BẢNG QUẢN TRỊ VIÊN & HÀM XÁC THỰC IS_ADMIN()
-- ========================================================

CREATE TABLE IF NOT EXISTS public.admin_users (
    user_id UUID PRIMARY KEY,
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read own admin_users" ON public.admin_users;
CREATE POLICY "Allow authenticated read own admin_users" ON public.admin_users
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- 1. Cho phép backend Service Role (SUPABASE_SERVICE_ROLE_KEY)
    IF (auth.jwt() ->> 'role') = 'service_role' OR current_user = 'service_role' THEN
        RETURN TRUE;
    END IF;

    -- 2. Kiểm tra UID người gọi trong danh sách admin_users được cấp quyền
    IF EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
        RETURN TRUE;
    END IF;

    -- 3. Kiểm tra claim role 'admin' trong app_metadata của JWT (chỉ backend/service_role mới gán được)
    IF (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' OR 
       (auth.jwt() -> 'app_metadata' ->> 'is_admin')::BOOLEAN IS TRUE THEN
        RETURN TRUE;
    END IF;

    -- TUYỆT ĐỐI KHÔNG coi mọi user authenticated là admin
    RETURN FALSE;
END;
$$;

-- Tự động liên kết tài khoản admin từ auth.users nếu đã tạo
INSERT INTO public.admin_users (user_id, email)
SELECT id, email FROM auth.users 
WHERE email = 'admin@phathocit.id.vn' 
   OR (raw_app_meta_data->>'role') = 'admin'
ON CONFLICT (user_id) DO NOTHING;

-- Hỗ trợ bảo hành thiết bị nội bộ (không bắt buộc customer_id khi chưa bán)
ALTER TABLE public.warranty_cases ALTER COLUMN customer_id DROP NOT NULL;

-- ========================================================
-- 3. SIẾT CHẶT STORAGE POLICIES CHO BUCKET EVIDENCE-PHOTOS
-- ========================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence-photos', 'evidence-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Xóa các policy lỏng lẻo chỉ kiểm tra role authenticated
DROP POLICY IF EXISTS "Allow authenticated insert on evidence-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated select on evidence-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete on evidence-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin insert on evidence-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin select on evidence-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin delete on evidence-photos" ON storage.objects;

-- Chỉ người dùng có quyền Admin mới được Upload ảnh bằng chứng
CREATE POLICY "Allow admin insert on evidence-photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'evidence-photos' AND public.is_admin());

-- Chỉ người dùng có quyền Admin mới được Đọc/Tạo signed URL
CREATE POLICY "Allow admin select on evidence-photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'evidence-photos' AND public.is_admin());

-- Chỉ người dùng có quyền Admin mới được Xóa ảnh bằng chứng
CREATE POLICY "Allow admin delete on evidence-photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'evidence-photos' AND public.is_admin());

-- ========================================================
-- 4. CẬP NHẬT KIỂM TRA IS_ADMIN() & CỐ ĐỊNH SEARCH_PATH
-- ========================================================

-- STABLE: Kiểm tra xuất kho
CREATE OR REPLACE FUNCTION public.fn_check_outbound_readiness(p_device_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_eligible BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM devices d
        WHERE d.id = p_device_id
          AND d.owner_type = 'INTERNAL'
          AND d.holder_type = 'INTERNAL_STORAGE'
          AND d.lifecycle = 'ACTIVE'
          AND d.technical_condition = 'USABLE'
          AND NOT EXISTS (
              SELECT 1 FROM assignments a
              WHERE a.device_id = d.id AND a.checkin_date IS NULL
          )
          AND NOT EXISTS (
              SELECT 1 FROM warranty_cases wc
              WHERE (wc.device_id = d.id OR wc.replaced_by_device_id = d.id)
                AND wc.case_status != 'COMPLETED'
          )
    ) INTO v_eligible;

    RETURN v_eligible;
END;
$$;

-- Nhập kho nguyên tử (Kiểm tra is_admin())
CREATE OR REPLACE FUNCTION public.rpc_confirm_inbound_receipt(
    p_receipt_id UUID,
    p_devices JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_receipt RECORD;
    v_item JSONB;
    v_product_id UUID;
    v_serial TEXT;
    v_code TEXT;
    v_condition TEXT;
    v_dev_id UUID;
    v_has_warranty BOOLEAN;
    v_war_start DATE;
    v_war_end DATE;
    v_war_note TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Thao tác yêu cầu quyền quản trị viên';
    END IF;

    SELECT * INTO v_receipt FROM inbound_receipts WHERE id = p_receipt_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiếu nhập %', p_receipt_id;
    END IF;

    IF v_receipt.status != 'DRAFT' THEN
        RAISE EXCEPTION 'Phiếu nhập đã ở trạng thái %, không thể xác nhận lại', v_receipt.status;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_devices) LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_serial := NULLIF(TRIM(v_item->>'serial_number'), '');
        v_code := TRIM(v_item->>'management_code');
        v_condition := COALESCE(v_item->>'technical_condition', 'USABLE');

        IF v_serial IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM devices WHERE serial_number = v_serial AND lifecycle = 'ACTIVE') THEN
                RAISE EXCEPTION 'Serial number % đã tồn tại trên hệ thống ở trạng thái ACTIVE', v_serial;
            END IF;
        END IF;

        INSERT INTO devices (
            product_id, management_code, serial_number, owner_type, holder_type,
            technical_condition, lifecycle, inbound_receipt_id
        ) VALUES (
            v_product_id, v_code, v_serial, 'INTERNAL', 'INTERNAL_STORAGE',
            v_condition, 'ACTIVE', p_receipt_id
        ) RETURNING id INTO v_dev_id;

        v_has_warranty := COALESCE((v_item->'supplier_warranty'->>'has_warranty')::BOOLEAN, false);
        IF v_has_warranty THEN
            v_war_start := (v_item->'supplier_warranty'->>'start_date')::DATE;
            v_war_end := (v_item->'supplier_warranty'->>'end_date')::DATE;
            v_war_note := v_item->'supplier_warranty'->>'terms_note';

            INSERT INTO warranty_policies (
                device_id, policy_type, source_event_type, source_event_id,
                has_warranty, start_date, end_date, terms_note
            ) VALUES (
                v_dev_id, 'SUPPLIER_POLICY', 'INBOUND', p_receipt_id,
                true, v_war_start, v_war_end, v_war_note
            );
        END IF;
    END LOOP;

    UPDATE inbound_items ii
    SET actual_quantity = (
        SELECT COUNT(*) FROM devices d 
        WHERE d.inbound_receipt_id = p_receipt_id AND d.product_id = ii.product_id
    )
    WHERE ii.receipt_id = p_receipt_id;

    UPDATE inbound_receipts
    SET status = 'CONFIRMED',
        updated_at = now()
    WHERE id = p_receipt_id;

    RETURN jsonb_build_object('success', true, 'receipt_id', p_receipt_id);
END;
$$;

-- Xuất kho nguyên tử (Kiểm tra is_admin())
CREATE OR REPLACE FUNCTION public.rpc_confirm_outbound_receipt(
    p_receipt_id UUID,
    p_device_ids UUID[],
    p_customer_warranty JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_receipt RECORD;
    v_dev_id UUID;
    v_is_ready BOOLEAN;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Thao tác yêu cầu quyền quản trị viên';
    END IF;

    SELECT * INTO v_receipt FROM outbound_receipts WHERE id = p_receipt_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiếu xuất %', p_receipt_id;
    END IF;

    IF v_receipt.status != 'DRAFT' THEN
        RAISE EXCEPTION 'Phiếu xuất đã ở trạng thái %, không thể xác nhận lại', v_receipt.status;
    END IF;

    FOREACH v_dev_id IN ARRAY p_device_ids LOOP
        v_is_ready := public.fn_check_outbound_readiness(v_dev_id);
        IF NOT v_is_ready THEN
            RAISE EXCEPTION 'Thiết bị % không đủ điều kiện sẵn sàng xuất kho', v_dev_id;
        END IF;

        INSERT INTO outbound_items (receipt_id, device_id)
        VALUES (p_receipt_id, v_dev_id);

        IF v_receipt.outbound_type IN ('SALE_INDIVIDUAL', 'SALE_ORG', 'GIVE_PERMANENT') THEN
            UPDATE devices
            SET owner_type = 'EXTERNAL',
                owner_party_id = v_receipt.recipient_party_id,
                holder_type = 'EXTERNAL_PARTY',
                holder_party_id = v_receipt.recipient_party_id,
                updated_at = now()
            WHERE id = v_dev_id;

            IF p_customer_warranty IS NOT NULL AND (p_customer_warranty->>'has_warranty')::BOOLEAN IS TRUE THEN
                INSERT INTO warranty_policies (
                    device_id, policy_type, source_event_type, source_event_id,
                    has_warranty, start_date, end_date, terms_note
                ) VALUES (
                    v_dev_id, 'CUSTOMER_POLICY', 'OUTBOUND_SALE', p_receipt_id,
                    TRUE,
                    (p_customer_warranty->>'start_date')::DATE,
                    (p_customer_warranty->>'end_date')::DATE,
                    p_customer_warranty->>'terms_note'
                );
            END IF;
        ELSIF v_receipt.outbound_type = 'RETURN_SUPPLIER' THEN
            UPDATE devices
            SET lifecycle = 'RETURNED_SUPPLIER',
                holder_type = 'EXTERNAL_PARTY',
                holder_party_id = v_receipt.recipient_party_id,
                updated_at = now()
            WHERE id = v_dev_id;
        END IF;
    END LOOP;

    UPDATE outbound_receipts
    SET status = 'CONFIRMED',
        updated_at = now()
    WHERE id = p_receipt_id;

    RETURN jsonb_build_object('success', true, 'receipt_id', p_receipt_id);
END;
$$;

-- Giao sử dụng / Cho mượn (Kiểm tra is_admin())
CREATE OR REPLACE FUNCTION public.rpc_create_assignment(
    p_device_id UUID,
    p_recipient_party_id UUID,
    p_assignment_type TEXT,
    p_expected_return_date DATE DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_ready BOOLEAN;
    v_assignment_id UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Thao tác yêu cầu quyền quản trị viên';
    END IF;

    v_is_ready := public.fn_check_outbound_readiness(p_device_id);
    IF NOT v_is_ready THEN
        RAISE EXCEPTION 'Thiết bị % không sẵn sàng để bàn giao', p_device_id;
    END IF;

    INSERT INTO assignments (
        device_id, recipient_party_id, assignment_type,
        checkout_date, expected_return_date, checkout_condition, checkout_notes
    ) VALUES (
        p_device_id, p_recipient_party_id, p_assignment_type,
        now(), p_expected_return_date, 'USABLE', p_notes
    ) RETURNING id INTO v_assignment_id;

    UPDATE devices
    SET holder_type = 'EXTERNAL_PARTY',
        holder_party_id = p_recipient_party_id,
        updated_at = now()
    WHERE id = p_device_id;

    RETURN jsonb_build_object('success', true, 'assignment_id', v_assignment_id);
END;
$$;

-- Thu hồi bàn giao (Kiểm tra is_admin())
CREATE OR REPLACE FUNCTION public.rpc_return_assignment(
    p_assignment_id UUID,
    p_checkin_condition TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_asg RECORD;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Thao tác yêu cầu quyền quản trị viên';
    END IF;

    SELECT * INTO v_asg FROM assignments WHERE id = p_assignment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy lượt bàn giao %', p_assignment_id;
    END IF;

    IF v_asg.checkin_date IS NOT NULL THEN
        RAISE EXCEPTION 'Lượt bàn giao này đã được thu hồi trước đó';
    END IF;

    UPDATE assignments
    SET checkin_date = now(),
        checkin_condition = p_checkin_condition,
        checkin_notes = p_notes,
        updated_at = now()
    WHERE id = p_assignment_id;

    UPDATE devices
    SET holder_type = 'INTERNAL_STORAGE',
        holder_party_id = NULL,
        technical_condition = p_checkin_condition,
        updated_at = now()
    WHERE id = v_asg.device_id;

    RETURN jsonb_build_object('success', true, 'assignment_id', p_assignment_id);
END;
$$;

-- Tiếp nhận bảo hành (Kiểm tra is_admin())
CREATE OR REPLACE FUNCTION public.rpc_create_warranty_case(
    p_device_id UUID,
    p_reported_fault TEXT,
    p_accessories TEXT DEFAULT NULL,
    p_performer TEXT DEFAULT 'Admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_dev RECORD;
    v_active_case_id UUID;
    v_sup_policy JSONB;
    v_cust_policy JSONB;
    v_case_code TEXT;
    v_case_id UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Thao tác yêu cầu quyền quản trị viên';
    END IF;

    SELECT * INTO v_dev FROM devices WHERE id = p_device_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy thiết bị %', p_device_id;
    END IF;

    SELECT id INTO v_active_case_id 
    FROM warranty_cases 
    WHERE (device_id = p_device_id OR replaced_by_device_id = p_device_id) 
      AND case_status != 'COMPLETED'
    LIMIT 1;

    IF v_active_case_id IS NOT NULL THEN
        RAISE EXCEPTION 'Thiết bị đang có hồ sơ bảo hành chưa hoàn tất (ID: %)', v_active_case_id;
    END IF;

    SELECT jsonb_build_object(
        'has_warranty', has_warranty,
        'start_date', start_date,
        'end_date', end_date,
        'terms_note', terms_note
    ) INTO v_sup_policy
    FROM warranty_policies
    WHERE device_id = p_device_id AND policy_type = 'SUPPLIER_POLICY'
    ORDER BY created_at DESC LIMIT 1;

    SELECT jsonb_build_object(
        'has_warranty', has_warranty,
        'start_date', start_date,
        'end_date', end_date,
        'terms_note', terms_note
    ) INTO v_cust_policy
    FROM warranty_policies
    WHERE device_id = p_device_id AND policy_type = 'CUSTOMER_POLICY'
    ORDER BY created_at DESC LIMIT 1;

    v_case_code := 'BH-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || floor(1000 + random() * 9000)::text;

    INSERT INTO warranty_cases (
        code, device_id, customer_id, case_status,
        snapshot_supplier_policy, snapshot_customer_policy,
        reported_fault, accessories_received
    ) VALUES (
        v_case_code, p_device_id, v_dev.owner_party_id, 'RECEIVED_CUSTOMER',
        COALESCE(v_sup_policy, '{"has_warranty": false, "terms_note": "Chưa có thông tin"}'::jsonb),
        COALESCE(v_cust_policy, '{"has_warranty": false, "terms_note": "Chưa có thông tin"}'::jsonb),
        p_reported_fault, p_accessories
    ) RETURNING id INTO v_case_id;

    INSERT INTO warranty_transitions (
        case_id, from_status, to_status, action_type, performer, notes
    ) VALUES (
        v_case_id, 'NEW', 'RECEIVED_CUSTOMER', 'INTAKE', p_performer, 'Tiếp nhận thiết bị từ khách'
    );

    UPDATE devices
    SET holder_type = 'INTERNAL_STORAGE',
        holder_party_id = NULL,
        technical_condition = 'NEEDS_INSPECTION',
        updated_at = now()
    WHERE id = p_device_id;

    RETURN jsonb_build_object(
        'success', true,
        'case_id', v_case_id,
        'case_code', v_case_code
    );
END;
$$;

-- Chuyển bước quy trình bảo hành (Kiểm tra is_admin())
CREATE OR REPLACE FUNCTION public.rpc_transition_warranty_case(
    p_case_id UUID,
    p_to_status TEXT,
    p_action_type TEXT,
    p_notes TEXT DEFAULT NULL,
    p_repair_outcome TEXT DEFAULT NULL,
    p_supplier_party_id UUID DEFAULT NULL,
    p_performer TEXT DEFAULT 'Admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_case RECORD;
    v_dev RECORD;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Thao tác yêu cầu quyền quản trị viên';
    END IF;

    SELECT * INTO v_case FROM warranty_cases WHERE id = p_case_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy hồ sơ bảo hành %', p_case_id;
    END IF;

    IF v_case.case_status = 'COMPLETED' THEN
        RAISE EXCEPTION 'Hồ sơ bảo hành đã hoàn tất, không thể chuyển bước tiếp';
    END IF;

    SELECT * INTO v_dev FROM devices WHERE id = COALESCE(v_case.replaced_by_device_id, v_case.device_id) FOR UPDATE;

    IF p_to_status = 'SENT_SUPPLIER' THEN
        IF v_case.case_status != 'RECEIVED_CUSTOMER' THEN
            RAISE EXCEPTION 'Chỉ có thể gửi NCC từ trạng thái RECEIVED_CUSTOMER';
        END IF;

        UPDATE devices
        SET holder_type = 'SUPPLIER_WARRANTY',
            holder_party_id = p_supplier_party_id,
            updated_at = now()
        WHERE id = v_dev.id;

    ELSIF p_to_status = 'RECEIVED_FROM_SUPPLIER' THEN
        IF v_case.case_status != 'SENT_SUPPLIER' THEN
            RAISE EXCEPTION 'Chỉ có thể nhận về từ NCC khi đang ở trạng thái SENT_SUPPLIER';
        END IF;

        UPDATE devices
        SET holder_type = 'INTERNAL_STORAGE',
            holder_party_id = NULL,
            updated_at = now()
        WHERE id = v_dev.id;

        IF p_repair_outcome IS NOT NULL THEN
            UPDATE warranty_cases SET repair_outcome = p_repair_outcome WHERE id = p_case_id;
        END IF;

    ELSIF p_to_status = 'RESOLVED_WAITING_RETURN' THEN
        IF v_case.case_status NOT IN ('RECEIVED_CUSTOMER', 'RECEIVED_FROM_SUPPLIER') THEN
            RAISE EXCEPTION 'Chuyển sang RESOLVED_WAITING_RETURN không hợp lệ từ trạng thái %', v_case.case_status;
        END IF;

        IF p_repair_outcome IS NOT NULL THEN
            UPDATE warranty_cases SET repair_outcome = p_repair_outcome WHERE id = p_case_id;
        END IF;

    ELSIF p_to_status = 'COMPLETED' THEN
        IF v_case.case_status != 'RESOLVED_WAITING_RETURN' THEN
            RAISE EXCEPTION 'Chỉ có thể bàn giao hoàn tất cho khách từ trạng thái RESOLVED_WAITING_RETURN';
        END IF;

        IF v_dev.owner_type = 'EXTERNAL' THEN
            UPDATE devices
            SET holder_type = 'EXTERNAL_PARTY',
                holder_party_id = v_dev.owner_party_id,
                technical_condition = 'USABLE',
                updated_at = now()
            WHERE id = v_dev.id;
        ELSE
            UPDATE devices
            SET holder_type = 'INTERNAL_STORAGE',
                technical_condition = 'USABLE',
                updated_at = now()
            WHERE id = v_dev.id;
        END IF;
    ELSE
        RAISE EXCEPTION 'Trạng thái đích % không hợp lệ', p_to_status;
    END IF;

    UPDATE warranty_cases
    SET case_status = p_to_status,
        updated_at = now()
    WHERE id = p_case_id;

    INSERT INTO warranty_transitions (
        case_id, from_status, to_status, action_type, performer, notes
    ) VALUES (
        p_case_id, v_case.case_status, p_to_status, p_action_type, p_performer, p_notes
    );

    RETURN jsonb_build_object('success', true, 'case_id', p_case_id, 'new_status', p_to_status);
END;
$$;

-- Đổi thiết bị / đổi SN (Kiểm tra is_admin())
CREATE OR REPLACE FUNCTION public.rpc_replace_warranty_device(
    p_case_id UUID,
    p_new_serial_number TEXT,
    p_new_management_code TEXT,
    p_new_warranty_policy JSONB DEFAULT NULL,
    p_reason TEXT DEFAULT 'NCC đổi thiết bị mới',
    p_performer TEXT DEFAULT 'Admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_case RECORD;
    v_old_dev RECORD;
    v_new_dev_id UUID;
    v_trimmed_sn TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Thao tác yêu cầu quyền quản trị viên';
    END IF;

    SELECT * INTO v_case FROM warranty_cases WHERE id = p_case_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy hồ sơ bảo hành %', p_case_id;
    END IF;

    IF v_case.case_status = 'COMPLETED' THEN
        RAISE EXCEPTION 'Hồ sơ bảo hành đã hoàn tất, không thể đổi máy';
    END IF;

    IF v_case.is_device_replaced IS TRUE THEN
        RAISE EXCEPTION 'Hồ sơ bảo hành này đã thực hiện đổi thiết bị trước đó';
    END IF;

    SELECT * INTO v_old_dev FROM devices WHERE id = v_case.device_id FOR UPDATE;

    v_trimmed_sn := NULLIF(TRIM(p_new_serial_number), '');
    IF v_trimmed_sn IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM devices WHERE serial_number = v_trimmed_sn AND lifecycle = 'ACTIVE') THEN
            RAISE EXCEPTION 'Serial number mới % đã tồn tại và đang ACTIVE trên hệ thống', v_trimmed_sn;
        END IF;
    END IF;

    INSERT INTO devices (
        product_id, management_code, serial_number,
        owner_type, owner_party_id,
        holder_type, holder_party_id,
        technical_condition, lifecycle
    ) VALUES (
        v_old_dev.product_id, TRIM(p_new_management_code), v_trimmed_sn,
        v_old_dev.owner_type, v_old_dev.owner_party_id,
        v_old_dev.holder_type, v_old_dev.holder_party_id,
        'USABLE', 'ACTIVE'
    ) RETURNING id INTO v_new_dev_id;

    UPDATE devices
    SET lifecycle = 'REPLACED',
        updated_at = now()
    WHERE id = v_old_dev.id;

    IF p_new_warranty_policy IS NOT NULL AND (p_new_warranty_policy->>'has_warranty')::BOOLEAN IS TRUE THEN
        INSERT INTO warranty_policies (
            device_id, policy_type, source_event_type, source_event_id,
            has_warranty, start_date, end_date, terms_note
        ) VALUES (
            v_new_dev_id, 'CUSTOMER_POLICY', 'MANUAL_OVERRIDE', p_case_id,
            TRUE,
            (p_new_warranty_policy->>'start_date')::DATE,
            (p_new_warranty_policy->>'end_date')::DATE,
            p_new_warranty_policy->>'terms_note'
        );
    END IF;

    INSERT INTO device_replacements (
        warranty_case_id, old_device_id, new_device_id, reason_and_proof
    ) VALUES (
        p_case_id, v_old_dev.id, v_new_dev_id, p_reason
    );

    UPDATE warranty_cases
    SET is_device_replaced = TRUE,
        replaced_by_device_id = v_new_dev_id,
        repair_outcome = COALESCE(repair_outcome, '') || ' [Đổi máy mới: ' || COALESCE(v_trimmed_sn, p_new_management_code) || ']',
        updated_at = now()
    WHERE id = p_case_id;

    INSERT INTO warranty_transitions (
        case_id, from_status, to_status, action_type, performer, notes
    ) VALUES (
        p_case_id, v_case.case_status, v_case.case_status, 'SWAP_DEVICE', p_performer, p_reason
    );

    RETURN jsonb_build_object(
        'success', true,
        'case_id', p_case_id,
        'new_device_id', v_new_dev_id
    );
END;
$$;

-- ========================================================
-- 5. THU HỒI TOÀN BỘ QUYỀN TRÊN TẤT CẢ RPC TỪ PUBLIC & ANON
-- ========================================================

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_check_outbound_readiness(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_confirm_inbound_receipt(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_confirm_outbound_receipt(UUID, UUID[], JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_create_assignment(UUID, UUID, TEXT, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_return_assignment(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_create_warranty_case(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_transition_warranty_case(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_replace_warranty_device(UUID, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon;

-- Cấp quyền gọi duy nhất cho role authenticated (bảo vệ kép bằng is_admin bên trong hàm)
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_outbound_readiness(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_confirm_inbound_receipt(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_confirm_outbound_receipt(UUID, UUID[], JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_assignment(UUID, UUID, TEXT, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_return_assignment(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_warranty_case(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_transition_warranty_case(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_replace_warranty_device(UUID, TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated;

-- Đánh dấu hoàn tất migration 3
INSERT INTO public.schema_migrations (version, name)
VALUES ('20261012000003', 'admin_role_and_security_hardening')
ON CONFLICT (version) DO NOTHING;
