-- Migration: Initial Schema & RPC Functions for IT Asset Management
-- Up migration: 20261012000000_initial_schema.sql

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Table: products (Dòng sản phẩm / model)
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    brand TEXT NOT NULL,
    category TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Table: parties (Đối tác: NCC, Khách hàng cá nhân/tổ chức, Nhân sự nội bộ)
CREATE TABLE IF NOT EXISTS parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('SUPPLIER', 'CUSTOMER_INDIVIDUAL', 'CUSTOMER_ORG', 'INTERNAL_MEMBER')),
    phone TEXT,
    email TEXT,
    address TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Table: inbound_receipts (Phiếu nhập kho)
CREATE TABLE IF NOT EXISTS inbound_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    supplier_id UUID NOT NULL REFERENCES parties(id),
    received_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Table: inbound_items (Chi tiết dòng sản phẩm phiếu nhập)
CREATE TABLE IF NOT EXISTS inbound_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES inbound_receipts(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    expected_quantity INT DEFAULT 0,
    actual_quantity INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Table: devices (Từng thiết bị cụ thể)
CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id),
    management_code TEXT UNIQUE NOT NULL,
    serial_number TEXT,
    owner_type TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (owner_type IN ('INTERNAL', 'EXTERNAL')),
    owner_party_id UUID REFERENCES parties(id),
    holder_type TEXT NOT NULL DEFAULT 'INTERNAL_STORAGE' CHECK (holder_type IN ('INTERNAL_STORAGE', 'EXTERNAL_PARTY', 'SUPPLIER_WARRANTY')),
    holder_party_id UUID REFERENCES parties(id),
    technical_condition TEXT NOT NULL DEFAULT 'USABLE' CHECK (technical_condition IN ('USABLE', 'NEEDS_INSPECTION', 'FAULTY')),
    lifecycle TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE', 'REPLACED', 'RETURNED_SUPPLIER')),
    inbound_receipt_id UUID REFERENCES inbound_receipts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial Unique Index to ensure unique serial_number among ACTIVE devices
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_active_serial_number 
ON devices (serial_number) 
WHERE serial_number IS NOT NULL AND lifecycle = 'ACTIVE';

-- 6. Table: warranty_policies (Chính sách bảo hành)
CREATE TABLE IF NOT EXISTS warranty_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    policy_type TEXT NOT NULL CHECK (policy_type IN ('SUPPLIER_POLICY', 'CUSTOMER_POLICY')),
    source_event_type TEXT NOT NULL CHECK (source_event_type IN ('INBOUND', 'OUTBOUND_SALE', 'OUTBOUND_ASSIGNMENT', 'MANUAL_OVERRIDE')),
    source_event_id UUID NOT NULL,
    has_warranty BOOLEAN NOT NULL DEFAULT TRUE,
    start_date DATE,
    end_date DATE,
    terms_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_warranty_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- 7. Table: outbound_receipts (Phiếu xuất kho)
CREATE TABLE IF NOT EXISTS outbound_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    recipient_party_id UUID NOT NULL REFERENCES parties(id),
    outbound_type TEXT NOT NULL CHECK (outbound_type IN ('SALE_INDIVIDUAL', 'SALE_ORG', 'GIVE_PERMANENT', 'RETURN_SUPPLIER')),
    outbound_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Table: outbound_items (Thiết bị theo phiếu xuất)
CREATE TABLE IF NOT EXISTS outbound_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES outbound_receipts(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Table: assignments (Giao sử dụng: Cho mượn hoặc Cấp nội bộ)
CREATE TABLE IF NOT EXISTS assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id),
    recipient_party_id UUID NOT NULL REFERENCES parties(id),
    assignment_type TEXT NOT NULL CHECK (assignment_type IN ('LOAN', 'LONG_TERM_ASSIGNMENT')),
    checkout_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    expected_return_date DATE,
    checkin_date TIMESTAMPTZ,
    checkout_condition TEXT NOT NULL DEFAULT 'USABLE',
    checkin_condition TEXT,
    checkout_notes TEXT,
    checkin_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. Table: warranty_cases (Hồ sơ bảo hành)
CREATE TABLE IF NOT EXISTS warranty_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    device_id UUID NOT NULL REFERENCES devices(id),
    customer_id UUID NOT NULL REFERENCES parties(id),
    case_status TEXT NOT NULL DEFAULT 'RECEIVED_CUSTOMER' 
        CHECK (case_status IN ('RECEIVED_CUSTOMER', 'SENT_SUPPLIER', 'RECEIVED_FROM_SUPPLIER', 'RESOLVED_WAITING_RETURN', 'COMPLETED')),
    snapshot_supplier_policy JSONB,
    snapshot_customer_policy JSONB,
    reported_fault TEXT NOT NULL,
    accessories_received TEXT,
    repair_outcome TEXT,
    is_device_replaced BOOLEAN NOT NULL DEFAULT FALSE,
    replaced_by_device_id UUID REFERENCES devices(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. Table: warranty_transitions (Lịch sử chuyển bước)
CREATE TABLE IF NOT EXISTS warranty_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES warranty_cases(id) ON DELETE CASCADE,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    action_type TEXT NOT NULL,
    performer TEXT,
    notes TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. Table: device_replacements (Bản ghi đổi thiết bị)
CREATE TABLE IF NOT EXISTS device_replacements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warranty_case_id UUID NOT NULL REFERENCES warranty_cases(id) ON DELETE CASCADE,
    old_device_id UUID NOT NULL REFERENCES devices(id),
    new_device_id UUID NOT NULL REFERENCES devices(id),
    replaced_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason_and_proof TEXT
);

-- 13. Table: evidence_photos (Bằng chứng ảnh)
CREATE TABLE IF NOT EXISTS evidence_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('INBOUND_RECEIPT', 'OUTBOUND_RECEIPT', 'ASSIGNMENT', 'WARRANTY_INTAKE', 'WARRANTY_TRANSFER', 'WARRANTY_RETURN', 'WARRANTY_DELIVERY', 'DEVICE_SN_LABEL')),
    entity_id UUID NOT NULL,
    device_id UUID REFERENCES devices(id),
    storage_key TEXT NOT NULL,
    watermark_meta JSONB,
    performer TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 14. Table: pending_uploads (Quản lý file đệm, dọn dẹp sau 24h)
CREATE TABLE IF NOT EXISTS pending_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_key TEXT NOT NULL,
    user_id UUID,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================================================
-- RPC FUNCTIONS: GIAO DỊCH NGUYÊN TỬ VÀ KIỂM TRA TẬP TRUNG
-- ========================================================

-- Kiểm tra điều kiện xuất kho tập trung
CREATE OR REPLACE FUNCTION fn_check_outbound_readiness(p_device_id UUID)
RETURNS BOOLEAN AS $$
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
$$ LANGUAGE plpgsql STABLE;

-- Xác nhận phiếu xuất kho nguyên tử
CREATE OR REPLACE FUNCTION rpc_confirm_outbound_receipt(
    p_receipt_id UUID,
    p_device_ids UUID[],
    p_customer_warranty JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_receipt RECORD;
    v_dev_id UUID;
    v_is_ready BOOLEAN;
BEGIN
    -- 1. Kiểm tra phiếu xuất
    SELECT * INTO v_receipt FROM outbound_receipts WHERE id = p_receipt_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiếu xuất %', p_receipt_id;
    END IF;

    IF v_receipt.status != 'DRAFT' THEN
        RAISE EXCEPTION 'Phiếu xuất đã ở trạng thái %, không thể xác nhận lại', v_receipt.status;
    END IF;

    -- 2. Kiểm tra từng thiết bị
    FOREACH v_dev_id IN ARRAY p_device_ids LOOP
        v_is_ready := fn_check_outbound_readiness(v_dev_id);
        IF NOT v_is_ready THEN
            RAISE EXCEPTION 'Thiết bị % không đủ điều kiện sẵn sàng xuất kho', v_dev_id;
        END IF;

        -- Ghi nhận vào outbound_items
        INSERT INTO outbound_items (receipt_id, device_id)
        VALUES (p_receipt_id, v_dev_id);

        -- Cập nhật trạng thái thiết bị theo loại xuất
        IF v_receipt.outbound_type IN ('SALE_INDIVIDUAL', 'SALE_ORG', 'GIVE_PERMANENT') THEN
            UPDATE devices
            SET owner_type = 'EXTERNAL',
                owner_party_id = v_receipt.recipient_party_id,
                holder_type = 'EXTERNAL_PARTY',
                holder_party_id = v_receipt.recipient_party_id,
                updated_at = now()
            WHERE id = v_dev_id;

            -- Tạo chính sách bảo hành khách nếu có
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

    -- 3. Đánh dấu phiếu hoàn tất
    UPDATE outbound_receipts
    SET status = 'CONFIRMED',
        updated_at = now()
    WHERE id = p_receipt_id;

    RETURN jsonb_build_object('success', true, 'receipt_id', p_receipt_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Xác nhận phiếu nhập kho nguyên tử
CREATE OR REPLACE FUNCTION rpc_confirm_inbound_receipt(
    p_receipt_id UUID,
    p_devices JSONB
)
RETURNS JSONB AS $$
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
    SELECT * INTO v_receipt FROM inbound_receipts WHERE id = p_receipt_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiếu nhập %', p_receipt_id;
    END IF;

    IF v_receipt.status != 'DRAFT' THEN
        RAISE EXCEPTION 'Phiếu nhập đã ở trạng thái %, không thể xác nhận lại', v_receipt.status;
    END IF;

    -- Lặp qua từng thiết bị cần nhập
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_devices) LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_serial := NULLIF(TRIM(v_item->>'serial_number'), '');
        v_code := TRIM(v_item->>'management_code');
        v_condition := COALESCE(v_item->>'technical_condition', 'USABLE');

        -- Kiểm tra trùng serial nếu có
        IF v_serial IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM devices WHERE serial_number = v_serial AND lifecycle = 'ACTIVE') THEN
                RAISE EXCEPTION 'Serial number % đã tồn tại trên hệ thống ở trạng thái ACTIVE', v_serial;
            END IF;
        END IF;

        -- Tạo bản ghi thiết bị
        INSERT INTO devices (
            product_id, management_code, serial_number, owner_type, holder_type,
            technical_condition, lifecycle, inbound_receipt_id
        ) VALUES (
            v_product_id, v_code, v_serial, 'INTERNAL', 'INTERNAL_STORAGE',
            v_condition, 'ACTIVE', p_receipt_id
        ) RETURNING id INTO v_dev_id;

        -- Chính sách bảo hành NCC nếu có
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

    -- Cập nhật actual_quantity trên inbound_items
    UPDATE inbound_items ii
    SET actual_quantity = (
        SELECT COUNT(*) FROM devices d 
        WHERE d.inbound_receipt_id = p_receipt_id AND d.product_id = ii.product_id
    )
    WHERE ii.receipt_id = p_receipt_id;

    -- Hoàn tất phiếu nhập
    UPDATE inbound_receipts
    SET status = 'CONFIRMED',
        updated_at = now()
    WHERE id = p_receipt_id;

    RETURN jsonb_build_object('success', true, 'receipt_id', p_receipt_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bàn giao cho mượn hoặc cấp nội bộ nguyên tử
CREATE OR REPLACE FUNCTION rpc_create_assignment(
    p_device_id UUID,
    p_recipient_party_id UUID,
    p_assignment_type TEXT,
    p_expected_return_date DATE DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_is_ready BOOLEAN;
    v_assignment_id UUID;
BEGIN
    v_is_ready := fn_check_outbound_readiness(p_device_id);
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

    -- Cập nhật holder của thiết bị
    UPDATE devices
    SET holder_type = 'EXTERNAL_PARTY',
        holder_party_id = p_recipient_party_id,
        updated_at = now()
    WHERE id = p_device_id;

    RETURN jsonb_build_object('success', true, 'assignment_id', v_assignment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Thu hồi thiết bị cho mượn / cấp nội bộ
CREATE OR REPLACE FUNCTION rpc_return_assignment(
    p_assignment_id UUID,
    p_checkin_condition TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_asg RECORD;
BEGIN
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

    -- Cập nhật đưa thiết bị về kho
    UPDATE devices
    SET holder_type = 'INTERNAL_STORAGE',
        holder_party_id = NULL,
        technical_condition = p_checkin_condition,
        updated_at = now()
    WHERE id = v_asg.device_id;

    RETURN jsonb_build_object('success', true, 'assignment_id', p_assignment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bật RLS cho toàn bộ các bảng nghiệp vụ
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_replacements ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_uploads ENABLE ROW LEVEL SECURITY;

-- Tạo policy mẫu: Chỉ role authenticated (admin) mới được thao tác
CREATE POLICY "Allow authenticated access to products" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to parties" ON parties FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to inbound_receipts" ON inbound_receipts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to inbound_items" ON inbound_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to devices" ON devices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to warranty_policies" ON warranty_policies FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to outbound_receipts" ON outbound_receipts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to outbound_items" ON outbound_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to assignments" ON assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to warranty_cases" ON warranty_cases FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to warranty_transitions" ON warranty_transitions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to device_replacements" ON device_replacements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to evidence_photos" ON evidence_photos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to pending_uploads" ON pending_uploads FOR ALL TO authenticated USING (true) WITH CHECK (true);
