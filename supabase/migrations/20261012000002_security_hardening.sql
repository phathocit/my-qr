-- Migration: Security Hardening & Storage Policies
-- Up migration: 20261012000002_security_hardening.sql

-- 1. BẢO MẬT STORAGE BUCKET 'evidence-photos'
-- Đảm bảo bucket ở chế độ Private
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence-photos', 'evidence-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Policy: Chỉ người dùng đã xác thực (Admin) mới được Upload vào bucket
CREATE POLICY "Allow authenticated insert on evidence-photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'evidence-photos');

-- Policy: Chỉ người dùng đã xác thực mới được Đọc/Lấy ảnh
CREATE POLICY "Allow authenticated select on evidence-photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'evidence-photos');

-- Policy: Chỉ người dùng đã xác thực mới được Xóa ảnh
CREATE POLICY "Allow authenticated delete on evidence-photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'evidence-photos');

-- 2. THU HỒI QUYỀN PUBLIC TRÊN TOÀN BỘ CÁC RPC FUNCTIONS
-- Chặn người dùng chưa đăng nhập (anon) gọi trực tiếp RPC
REVOKE EXECUTE ON FUNCTION fn_check_outbound_readiness(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_confirm_inbound_receipt(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_confirm_outbound_receipt(UUID, UUID[], JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_create_assignment(UUID, UUID, TEXT, DATE, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_return_assignment(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_create_warranty_case(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_transition_warranty_case(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_replace_warranty_device(UUID, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;

-- Cấp quyền gọi duy nhất cho role authenticated (Admin)
GRANT EXECUTE ON FUNCTION fn_check_outbound_readiness(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_confirm_inbound_receipt(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_confirm_outbound_receipt(UUID, UUID[], JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_create_assignment(UUID, UUID, TEXT, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_return_assignment(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_create_warranty_case(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_transition_warranty_case(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_replace_warranty_device(UUID, TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated;
