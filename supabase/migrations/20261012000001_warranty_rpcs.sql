-- Migration: Warranty RPC Functions & Atomic State Transitions (Hardened)
-- Up migration: 20261012000001_warranty_rpcs.sql

-- 0. Bảng quản trị viên và Hàm kiểm tra quyền Admin tập trung
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
    -- 1. Kiểm tra UID trong bảng admin_users
    IF EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
        RETURN TRUE;
    END IF;

    -- 2. Kiểm tra claim role admin trong JWT app_metadata
    IF (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' OR 
       (auth.jwt() -> 'app_metadata' ->> 'is_admin')::BOOLEAN IS TRUE THEN
        RETURN TRUE;
    END IF;

    -- Không coi mọi user authenticated là admin
    RETURN FALSE;
END;
$$;

-- 1. Tiếp nhận bảo hành nguyên tử (Lưu snapshot 2 chính sách)
CREATE OR REPLACE FUNCTION rpc_create_warranty_case(
    p_device_id UUID,
    p_reported_fault TEXT,
    p_accessories TEXT DEFAULT NULL,
    p_performer TEXT DEFAULT 'Admin'
)
RETURNS JSONB AS $$
DECLARE
    v_dev RECORD;
    v_active_case_id UUID;
    v_sup_policy JSONB;
    v_cust_policy JSONB;
    v_case_code TEXT;
    v_case_id UUID;
BEGIN
    -- Kiểm tra quyền admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Thao tác yêu cầu quyền quản trị viên';
    END IF;

    -- 1. Kiểm tra thiết bị
    SELECT * INTO v_dev FROM devices WHERE id = p_device_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy thiết bị %', p_device_id;
    END IF;

    -- 2. Chặn nếu đang có hồ sơ bảo hành mở
    SELECT id INTO v_active_case_id 
    FROM warranty_cases 
    WHERE (device_id = p_device_id OR replaced_by_device_id = p_device_id) 
      AND case_status != 'COMPLETED'
    LIMIT 1;

    IF v_active_case_id IS NOT NULL THEN
        RAISE EXCEPTION 'Thiết bị đang có hồ sơ bảo hành chưa hoàn tất (ID: %)', v_active_case_id;
    END IF;

    -- 3. Tạo snapshot chính sách bảo hành NCC
    SELECT jsonb_build_object(
        'has_warranty', has_warranty,
        'start_date', start_date,
        'end_date', end_date,
        'terms_note', terms_note
    ) INTO v_sup_policy
    FROM warranty_policies
    WHERE device_id = p_device_id AND policy_type = 'SUPPLIER_POLICY'
    ORDER BY created_at DESC LIMIT 1;

    -- 4. Tạo snapshot chính sách bảo hành Khách
    SELECT jsonb_build_object(
        'has_warranty', has_warranty,
        'start_date', start_date,
        'end_date', end_date,
        'terms_note', terms_note
    ) INTO v_cust_policy
    FROM warranty_policies
    WHERE device_id = p_device_id AND policy_type = 'CUSTOMER_POLICY'
    ORDER BY created_at DESC LIMIT 1;

    -- 5. Sinh mã hồ sơ BH-YYYYMMDD-XXXX
    v_case_code := 'BH-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || floor(1000 + random() * 9000)::text;

    -- 6. Tạo hồ sơ bảo hành
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

    -- 7. Ghi nhận lịch sử chuyển bước
    INSERT INTO warranty_transitions (
        case_id, from_status, to_status, action_type, performer, notes
    ) VALUES (
        v_case_id, 'NEW', 'RECEIVED_CUSTOMER', 'INTAKE', p_performer, 'Tiếp nhận thiết bị từ khách'
    );

    -- 8. Cập nhật vị trí vật lý: đưa về người quản lý (INTERNAL_STORAGE) & tình trạng NEEDS_INSPECTION
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 2. Chuyển bước quy trình bảo hành (Hỗ trợ luồng chuẩn & các nhánh ngoại lệ)
CREATE OR REPLACE FUNCTION rpc_transition_warranty_case(
    p_case_id UUID,
    p_to_status TEXT,
    p_action_type TEXT,
    p_notes TEXT DEFAULT NULL,
    p_repair_outcome TEXT DEFAULT NULL,
    p_supplier_party_id UUID DEFAULT NULL,
    p_performer TEXT DEFAULT 'Admin'
)
RETURNS JSONB AS $$
DECLARE
    v_case RECORD;
    v_dev RECORD;
BEGIN
    -- Kiểm tra quyền admin
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

    -- Kiểm tra state machine hợp lệ
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3. Đổi thiết bị (Đổi SN) trong bảo hành
CREATE OR REPLACE FUNCTION rpc_replace_warranty_device(
    p_case_id UUID,
    p_new_serial_number TEXT,
    p_new_management_code TEXT,
    p_new_warranty_policy JSONB DEFAULT NULL,
    p_reason TEXT DEFAULT 'NCC đổi thiết bị mới',
    p_performer TEXT DEFAULT 'Admin'
)
RETURNS JSONB AS $$
DECLARE
    v_case RECORD;
    v_old_dev RECORD;
    v_new_dev_id UUID;
    v_trimmed_sn TEXT;
BEGIN
    -- Kiểm tra quyền admin
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

    -- 1. Tạo bản ghi thiết bị mới
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

    -- 2. Đánh dấu thiết bị cũ thành REPLACED
    UPDATE devices
    SET lifecycle = 'REPLACED',
        updated_at = now()
    WHERE id = v_old_dev.id;

    -- 3. Tạo chính sách bảo hành cho thiết bị mới nếu có
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

    -- 4. Lưu liên kết đổi thiết bị
    INSERT INTO device_replacements (
        warranty_case_id, old_device_id, new_device_id, reason_and_proof
    ) VALUES (
        p_case_id, v_old_dev.id, v_new_dev_id, p_reason
    );

    -- 5. Cập nhật hồ sơ bảo hành
    UPDATE warranty_cases
    SET is_device_replaced = TRUE,
        replaced_by_device_id = v_new_dev_id,
        repair_outcome = COALESCE(repair_outcome, '') || ' [Đổi máy mới: ' || COALESCE(v_trimmed_sn, p_new_management_code) || ']',
        updated_at = now()
    WHERE id = p_case_id;

    -- 6. Ghi nhận transition
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Thu hồi quyền từ PUBLIC và anon, chỉ cấp cho authenticated
REVOKE ALL ON FUNCTION rpc_create_warranty_case(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION rpc_transition_warranty_case(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION rpc_replace_warranty_device(UUID, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION rpc_create_warranty_case(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_transition_warranty_case(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_replace_warranty_device(UUID, TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated;

