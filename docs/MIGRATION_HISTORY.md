# Lịch Sử & Cơ Chế Quản Lý Supabase Migration

## 1. Cơ Chế Theo Dõi Migration Trong Database

Dự án sử dụng bảng `public.schema_migrations` để theo dõi các migration đã áp dụng, đảm bảo tính bất biến (idempotent) và tránh áp dụng lặp:

```sql
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 2. Danh Sách & Trạng Thái Migration

| STT | Phiên bản (Version) | Tên Migration | Trạng thái Cloud | Nội dung chính |
| :---: | :--- | :--- | :---: | :--- |
| 1 | `20261012000000` | `initial_schema` | **ĐÃ ÁP DỤNG** | Schema 14 bảng: `products`, `parties`, `devices`, `inbound_receipts`, `outbound_receipts`, `assignments`, v.v. Kèm các RPC: `fn_check_outbound_readiness`, `rpc_confirm_inbound_receipt`, `rpc_confirm_outbound_receipt`, `rpc_create_assignment`, `rpc_return_assignment`. |
| 2 | `20261012000001` | `warranty_rpcs` | **ĐÃ ÁP DỤNG** | Bộ 3 RPC bảo hành nguyên tử: `rpc_create_warranty_case`, `rpc_transition_warranty_case`, `rpc_replace_warranty_device` (Đổi SN, máy cũ sang `REPLACED`, máy mới `ACTIVE`). |
| 3 | `20261012000002` | `security_hardening` | **ĐÃ ÁP DỤNG** | Khởi tạo bucket `evidence-photos` (private), thu hồi quyền ban đầu từ `PUBLIC` và cấp quyền cho `authenticated`. |
| 4 | `20261012000003` | `admin_role_and_security_hardening` | **MIGRATION MỚI** | Bổ sung bảng `admin_users`, hàm `is_admin()`, siết Storage policies, thu hồi quyền từ `anon`, cố định `search_path = public, pg_temp` và bổ sung kiểm tra `is_admin()` trong tất cả RPC. |

---

## 3. Quy Tắc Bất Biến Khi Làm Việc Với Migration
1. **Không chỉnh sửa hoặc chạy lại** các file migration đã được đánh dấu **ĐÃ ÁP DỤNG** (`20261012000000`, `20261012000001`, `20261012000002`).
2. Mọi thay đổi về schema, hàm hoặc phân quyền bắt buộc phải tạo file migration mới với timestamp kế tiếp (ví dụ: `20261012000003_...sql`).
3. Không bao giờ reset database để tránh mất dữ liệu sản xuất.
