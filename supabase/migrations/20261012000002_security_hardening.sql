-- Migration: Security Hardening, Admin Role Verification & Storage Policies
-- Up migration: 20261012000002_security_hardening.sql

-- ========================================================
-- 1. BẢNG QUẢN TRỊ VIÊN & HÀM XÁC THỰC QUYỀN ADMIN TẬP TRUNG
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
    -- 1. Kiểm tra UID người gọi trong danh sách admin_users được cấp quyền
    IF EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
        RETURN TRUE;
    END IF;

    -- 2. Kiểm tra claim role 'admin' trong app_metadata của JWT (chỉ backend/service_role mới gán được)
    IF (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' OR 
       (auth.jwt() -> 'app_metadata' ->> 'is_admin')::BOOLEAN IS TRUE THEN
        RETURN TRUE;
    END IF;

    -- TUYỆT ĐỐI KHÔNG coi mọi user authenticated là admin
    RETURN FALSE;
END;
$$;

-- ========================================================
-- 2. BẢO MẬT STORAGE BUCKET 'evidence-photos' VỚI IS_ADMIN()
-- ========================================================

-- Đảm bảo bucket ở chế độ Private
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence-photos', 'evidence-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Xóa toàn bộ policy cũ (tránh trường hợp chỉ kiểm tra TO authenticated lỏng lẻo)
DROP POLICY IF EXISTS "Allow authenticated insert on evidence-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated select on evidence-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete on evidence-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin insert on evidence-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin select on evidence-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin delete on evidence-photos" ON storage.objects;

-- Policy: Chỉ người dùng thuộc Admin mới được Upload vào bucket
CREATE POLICY "Allow admin insert on evidence-photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'evidence-photos' AND public.is_admin());

-- Policy: Chỉ người dùng thuộc Admin mới được Đọc/Lấy signed URL
CREATE POLICY "Allow admin select on evidence-photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'evidence-photos' AND public.is_admin());

-- Policy: Chỉ người dùng thuộc Admin mới được Xóa ảnh
CREATE POLICY "Allow admin delete on evidence-photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'evidence-photos' AND public.is_admin());

-- ========================================================
-- 3. CỦNG CỐ CÁC HÀM TỪ MIGRATION 1 (SEARCH_PATH & IS_ADMIN)
-- ========================================================

-- Hàm kiểm tra xuất kho (STABLE, cố định search_path)
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

-- Xác nhận xuất kho nguyên tử (SECURITY DEFINER + search_path + is_admin)
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

-- Xác nhận nhập kho nguyên tử (SECURITY DEFINER + search_path + is_admin)
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

-- Bàn giao cho mượn / cấp nội bộ (SECURITY DEFINER + search_path + is_admin)
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

-- Thu hồi thiết bị (SECURITY DEFINER + search_path + is_admin)
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

-- ========================================================
-- 4. THU HỒI TOÀN DIỆN QUYỀN TỪ PUBLIC VÀ ANON TRÊN TẤT CẢ RPC
-- ========================================================

-- Lưu ý: REVOKE ALL FROM PUBLIC chưa chứng minh anon không còn grant riêng.
-- Bắt buộc phải REVOKE rõ ràng từ cả PUBLIC và anon!

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_check_outbound_readiness(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_confirm_inbound_receipt(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_confirm_outbound_receipt(UUID, UUID[], JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_create_assignment(UUID, UUID, TEXT, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_return_assignment(UUID, TEXT, TEXT) FROM PUBLIC, anon;

-- Với các hàm bảo hành (Migration 2):
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_create_warranty_case') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.rpc_create_warranty_case(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.rpc_create_warranty_case(UUID, TEXT, TEXT, TEXT) TO authenticated;';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_transition_warranty_case') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.rpc_transition_warranty_case(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.rpc_transition_warranty_case(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_replace_warranty_device') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.rpc_replace_warranty_device(UUID, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon;';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.rpc_replace_warranty_device(UUID, TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated;';
    END IF;
END $$;

-- Cấp quyền gọi cho authenticated (Kiểm tra quyền admin được siết bên trong hàm bằng is_admin())
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_outbound_readiness(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_confirm_inbound_receipt(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_confirm_outbound_receipt(UUID, UUID[], JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_assignment(UUID, UUID, TEXT, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_return_assignment(UUID, TEXT, TEXT) TO authenticated;
