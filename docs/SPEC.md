# Đặc tả Kỹ thuật & Nghiệp vụ Hệ thống Quản lý Thiết bị CNTT

Tài liệu chuẩn hóa kiến trúc kỹ thuật, mô hình dữ liệu, hàm RPC giao dịch nguyên tử, phân quyền RLS, lưu trữ Storage và các kịch bản nghiệm thu.

---

## 1. Kiến Trúc Kỹ Thuật (Architecture)

- **Frontend & Server Layer**: Next.js App Router (TypeScript), mobile-first responsive.
- **Backend Infrastructure**: Supabase (PostgreSQL, Supabase Auth, Supabase Storage).
- **Session & Auth**: `@supabase/ssr` cho cookie session phía server, 1 tài khoản quản trị (email + mật khẩu). Tắt tính năng tự đăng ký công khai (`disable public signups`).
- **Giao dịch nguyên tử (Atomic Transactions)**: Toàn bộ thao tác nghiệp vụ quan trọng (xác nhận phiếu nhập, xuất kho, giao/thu hồi, chuyển bước và đổi thiết bị trong bảo hành) được thực thi qua **PostgreSQL Functions (RPC)** với `BEGIN ... EXCEPTION ... COMMIT` và `SECURITY DEFINER` (chỉ cấp quyền execute cho role `authenticated`).
- **Bảo mật dữ liệu**: Row Level Security (RLS) bật trên toàn bộ các bảng nghiệp vụ. Chỉ cho phép tài khoản đã xác thực truy xuất. Tuyệt đối không để lộ `SUPABASE_SERVICE_ROLE_KEY` ra browser hoặc biến `NEXT_PUBLIC_*`.
- **Lưu trữ ảnh (Storage)**: Private bucket trong Supabase Storage. Cơ sở dữ liệu chỉ lưu `storage_key`. Truy cập xem ảnh qua Signed URL có thời hạn ngắn (30-60 phút) được sinh từ server.
- **Triển khai (Deployment)**: Docker multi-stage build với chế độ `output: 'standalone'` của Next.js, chạy trên VM của chủ dự án sau reverse proxy HTTPS (bắt buộc cho Web Camera API).

---

## 2. Mô hình Thực thể & Bảng Dữ liệu (PostgreSQL Schema)

### 2.1. Các bảng danh mục & cốt lõi
1. `products`:
   - `id` (UUID PK, gen_random_uuid())
   - `name` (TEXT, NOT NULL)
   - `brand` (TEXT, NOT NULL)
   - `category` (TEXT)
   - `created_at` (TIMESTAMPTZ DEFAULT now())

2. `parties`:
   - `id` (UUID PK, gen_random_uuid())
   - `name` (TEXT, NOT NULL)
   - `type` (TEXT CHECK (type IN ('SUPPLIER', 'CUSTOMER_INDIVIDUAL', 'CUSTOMER_ORG', 'INTERNAL_MEMBER')))
   - `phone` (TEXT), `email` (TEXT), `notes` (TEXT)
   - `created_at` (TIMESTAMPTZ DEFAULT now())

3. `devices`:
   - `id` (UUID PK, gen_random_uuid())
   - `product_id` (UUID REFERENCES products(id), NOT NULL)
   - `management_code` (TEXT UNIQUE NOT NULL) -- Mã nội bộ tự sinh (VD: `DEV-20261012-XXXX`)
   - `serial_number` (TEXT) -- SN gốc nhà sản xuất (giữ nguyên không chuẩn hóa tùy tiện)
   - `owner_type` (TEXT NOT NULL CHECK (owner_type IN ('INTERNAL', 'EXTERNAL')))
   - `owner_party_id` (UUID REFERENCES parties(id)) -- NULL nếu thuộc nội bộ
   - `holder_type` (TEXT NOT NULL CHECK (holder_type IN ('INTERNAL_STORAGE', 'EXTERNAL_PARTY', 'SUPPLIER_WARRANTY')))
   - `holder_party_id` (UUID REFERENCES parties(id)) -- NULL nếu đang ở INTERNAL_STORAGE
   - `technical_condition` (TEXT NOT NULL CHECK (technical_condition IN ('USABLE', 'NEEDS_INSPECTION', 'FAULTY')))
   - `lifecycle` (TEXT NOT NULL CHECK (lifecycle IN ('ACTIVE', 'REPLACED', 'RETURNED_SUPPLIER')))
   - `inbound_receipt_id` (UUID) -- Phiếu nhập ban đầu
   - `created_at`, `updated_at` (TIMESTAMPTZ DEFAULT now())
   - *Ràng buộc chống trùng*: `UNIQUE NULLS NOT DISTINCT (serial_number)` hoặc partial unique index `WHERE serial_number IS NOT NULL AND lifecycle = 'ACTIVE'`.

4. `warranty_policies`:
   - `id` (UUID PK, gen_random_uuid())
   - `device_id` (UUID REFERENCES devices(id), NOT NULL)
   - `policy_type` (TEXT CHECK (policy_type IN ('SUPPLIER_POLICY', 'CUSTOMER_POLICY')))
   - `source_event_type` (TEXT CHECK (source_event_type IN ('INBOUND', 'OUTBOUND_SALE', 'OUTBOUND_ASSIGNMENT', 'MANUAL_OVERRIDE')))
   - `source_event_id` (UUID NOT NULL)
   - `has_warranty` (BOOLEAN DEFAULT TRUE)
   - `start_date` (DATE)
   - `end_date` (DATE)
   - `terms_note` (TEXT)
   - `created_at` (TIMESTAMPTZ DEFAULT now())
   - *Ràng buộc kiểm tra*: `CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)`

5. `assignments`:
   - `id` (UUID PK, gen_random_uuid())
   - `device_id` (UUID REFERENCES devices(id), NOT NULL)
   - `recipient_party_id` (UUID REFERENCES parties(id), NOT NULL)
   - `assignment_type` (TEXT CHECK (assignment_type IN ('LOAN', 'LONG_TERM_ASSIGNMENT')))
   - `checkout_date` (TIMESTAMPTZ NOT NULL DEFAULT now())
   - `expected_return_date` (DATE)
   - `checkin_date` (TIMESTAMPTZ) -- NULL = đang mở
   - `checkout_condition` (TEXT NOT NULL)
   - `checkin_condition` (TEXT)
   - `checkout_notes` (TEXT), `checkin_notes` (TEXT)

6. `inbound_receipts` & `inbound_items`:
   - `inbound_receipts`: `id`, `code` (UNIQUE), `supplier_id` (FK parties), `received_date`, `status` (`DRAFT`, `CONFIRMED`, `CANCELLED`), `notes`, `created_at`.
   - `inbound_items`: `id`, `receipt_id` (FK), `product_id` (FK), `expected_quantity`, `actual_quantity`.

7. `outbound_receipts` & `outbound_items`:
   - `outbound_receipts`: `id`, `code` (UNIQUE), `recipient_party_id` (FK), `outbound_type` (`SALE_INDIVIDUAL`, `SALE_ORG`, `GIVE_PERMANENT`, `RETURN_SUPPLIER`), `outbound_date`, `status` (`DRAFT`, `CONFIRMED`, `CANCELLED`), `notes`.
   - `outbound_items`: `id`, `receipt_id` (FK), `device_id` (FK).

8. `warranty_cases` & `warranty_transitions`:
   - `warranty_cases`:
     - `id` (UUID PK)
     - `code` (TEXT UNIQUE)
     - `device_id` (UUID REFERENCES devices(id))
     - `customer_id` (UUID REFERENCES parties(id))
     - `case_status` (`RECEIVED_CUSTOMER`, `SENT_SUPPLIER`, `RECEIVED_FROM_SUPPLIER`, `RESOLVED_WAITING_RETURN`, `COMPLETED`)
     - `snapshot_supplier_policy` (JSONB)
     - `snapshot_customer_policy` (JSONB)
     - `reported_fault` (TEXT), `accessories_received` (TEXT), `repair_outcome` (TEXT)
     - `is_device_replaced` (BOOLEAN DEFAULT FALSE)
     - `replaced_by_device_id` (UUID REFERENCES devices(id))
   - `warranty_transitions`:
     - `id`, `case_id`, `from_status`, `to_status`, `action_type`, `notes`, `performer`, `occurred_at`.

9. `device_replacements`:
   - `id`, `warranty_case_id`, `old_device_id`, `new_device_id`, `replaced_date`, `reason_and_proof`.

10. `evidence_photos` & `pending_uploads`:
    - `evidence_photos`: `id`, `entity_type`, `entity_id`, `device_id`, `storage_key`, `watermark_meta` (JSONB), `performer`, `created_at`.
    - `pending_uploads`: `id`, `storage_key`, `user_id`, `expires_at` (sau 24h tự động dọn rác).

---

## 3. Hàm PostgreSQL Functions / RPC Nghiệp Vụ Nguyên Tử

Mọi thao tác thay đổi trạng thái đều được bọc trong PostgreSQL Function:

1. `fn_check_outbound_readiness(p_device_id UUID) RETURNS BOOLEAN`:
   Kiểm tra đồng thời:
   - `owner_type = 'INTERNAL'`
   - `holder_type = 'INTERNAL_STORAGE'`
   - `lifecycle = 'ACTIVE'`
   - `technical_condition = 'USABLE'`
   - Không có `assignments` mở (`checkin_date IS NULL`).
   - Không có `warranty_cases` mở (`case_status != 'COMPLETED'`).

2. `rpc_confirm_inbound_receipt(p_receipt_id UUID, p_devices JSONB) RETURNS VOID`:
   - Kiểm tra trạng thái phiếu nhập đang là `DRAFT`.
   - Chống trùng lặp SN trong lô và trên toàn hệ thống.
   - Insert các bản ghi thiết bị vào `devices` với `owner_type = 'INTERNAL'`, `holder_type = 'INTERNAL_STORAGE'`, `lifecycle = 'ACTIVE'`.
   - Tạo chính sách bảo hành NCC nếu có.
   - Cập nhật số lượng thực nhập `actual_quantity` và chuyển trạng thái phiếu sang `CONFIRMED`.

3. `rpc_confirm_outbound_receipt(p_receipt_id UUID, p_device_ids UUID[], p_customer_warranty JSONB) RETURNS VOID`:
   - Chặn nếu phiếu đã xác nhận (chống submit lặp qua Idempotency Token hoặc trạng thái).
   - Kiểm tra `fn_check_outbound_readiness` trên từng thiết bị.
   - Nếu là bán lẻ/bán tổ chức/cấp hẳn: Cập nhật `owner_type = 'EXTERNAL'`, `owner_party_id = recipient_party_id`, `holder_type = 'EXTERNAL_PARTY'`, `holder_party_id = recipient_party_id`.
   - Tạo chính sách bảo hành khách nếu có.
   - Chuyển trạng thái phiếu sang `CONFIRMED`.

4. `rpc_create_assignment(...)` & `rpc_return_assignment(...)`:
   - Mượn / cấp lâu dài: Kiểm tra sẵn sàng, cập nhật `holder_type = 'EXTERNAL_PARTY'`, giữ nguyên `owner_type = 'INTERNAL'`.
   - Thu hồi: Ghi nhận tình trạng kỹ thuật lúc nhận lại (`USABLE` / `NEEDS_INSPECTION` / `FAULTY`), cập nhật `holder_type = 'INTERNAL_STORAGE'`, đóng `checkin_date`.

5. `rpc_transition_warranty_case(...)` & `rpc_replace_warranty_device(...)`:
   - Kiểm tra tính hợp lệ của bước chuyển trạng thái (bảo vệ state machine).
   - Khi đổi thiết bị: Đánh dấu thiết bị cũ `lifecycle = 'REPLACED'`, liên kết thiết bị mới, gán quyền sở hữu theo giao dịch đổi máy, không tự tiện nhập thành hàng sẵn sàng bán.

---

## 4. Kế Hoạch Docker & Triển Khai (Next.js Standalone)

- `Dockerfile`: Multi-stage build (deps -> builder -> runner), sử dụng node-alpine, tối ưu kích thước image và bảo mật.
- `docker-compose.yml`: Chỉ chứa service `web` (Next.js) kết nối ra Supabase bên ngoài thông qua biến môi trường.
- `.env.example`:
  ```bash
  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-only-used-in-server
  APP_ENV=production
  ```
- **Lưu ý Reverse Proxy & HTTPS**: Trình duyệt trên thiết bị di động (Chrome/Safari) chặn quyền truy cập `navigator.mediaDevices.getUserMedia` nếu không chạy qua giao thức HTTPS (ngoại trừ `localhost`). Do đó, VM cần chạy qua Reverse Proxy (Nginx, Caddy, hoặc Cloudflare) có SSL certificate hợp lệ.

---

## 5. Danh Mục Test Case Nghiệm Thu (Acceptance Criteria)

1. **TC-01: Nhập kho đa sản phẩm & Quét liên tục giữ dòng**: Quét nhiều model trong 1 phiếu, tự động cập nhật số lượng và thiết bị.
2. **TC-02: Chống trùng SN**: Phát hiện và chặn tạo mới SN trùng lặp cả trong phiếu nháp và với dữ liệu đã có.
3. **TC-03: Cấp mã nội bộ cho thiết bị không SN**: Tự sinh mã duy nhất `DEV-...`.
4. **TC-04: Outbound Readiness (Kiểm tra nghiêm ngặt)**: Chặn xuất thiết bị đang mượn, đang bảo hành, lỗi phần cứng hoặc đã bán.
5. **TC-05: Chống submit đúp (Idempotency)**: Bấm xác nhận 2 lần không tạo 2 giao dịch.
6. **TC-06: Bảo hành 2 phía độc lập & Snapshot**: Lưu giữ snapshot thời hạn tại lúc nhận; sửa đổi chính sách gốc sau đó không làm thay đổi lịch sử.
7. **TC-07: Luồng ngoại lệ bảo hành**: Hỗ trợ sửa tại chỗ chờ trả khách; hỗ trợ NCC từ chối bảo hành; không tự động đưa máy về `READY` khi hoàn tất.
8. **TC-08: Đổi SN khi bảo hành**: Thiết bị cũ sang `REPLACED`, thiết bị mới liên kết hồ sơ, kế thừa người sở hữu từ giao dịch đổi.
9. **TC-09: Bằng chứng ảnh & Private Storage**: Ảnh lưu vào private bucket, chỉ truy xuất qua signed URL ngắn hạn, dọn dẹp ảnh upload bỏ dở.
10. **TC-10: Quét Camera & Fallback**: Thao tác camera mượt trên mobile (khi có HTTPS), dừng nhận mã lặp, có phương án nhập tay khi camera không đọc được tem.
