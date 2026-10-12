# Hướng Dẫn Triển Khai Next.js Lên Vercel & Kết Nối Supabase Cloud

Tài liệu hướng dẫn deploy ứng dụng lên **Vercel (Gói Hobby Miễn phí)** kết nối với **Supabase Cloud (Gói Free)**, nghiệm thu trực tiếp qua domain HTTPS của Vercel mà không cần cấu hình VM hay tên miền riêng ở giai đoạn này.

---

## 1. Kiểm Tra Tính Tương Thích Với Vercel

Ứng dụng đáp ứng 100% kiến trúc không trạng thái (stateless) của Vercel:
- **Dữ liệu nghiệp vụ**: Lưu trữ và truy vấn trực tiếp qua Supabase Cloud (PostgreSQL) với RLS và RPC Functions.
- **Ảnh bằng chứng**: Nén ảnh canvas phía client và lưu trữ trực tiếp vào Supabase Storage (Private Bucket `evidence-photos`). Hoàn toàn không ghi file vào ổ đĩa cục bộ của server.
- **Bảo mật Camera**: Vercel tự động cấp chứng chỉ HTTPS cho mọi domain `*.vercel.app`, đáp ứng tiêu chuẩn bảo mật của trình duyệt di động để mở Camera quét barcode/QR.
- **Chi phí**: Sử dụng gói Vercel Hobby (Miễn phí) và Supabase Free Tier (Miễn phí). Không có chi phí phát sinh.

---

## 2. Các Bước Triển Khai Lên Vercel

### Bước 2.1: Đẩy mã nguồn lên GitHub (hoặc GitLab / Bitbucket)
1. Khởi tạo Git (nếu chưa có) và commit toàn bộ source code:
   ```bash
   git add .
   git commit -m "feat: hoàn thiện quản lý thiết bị cntt và quy trình bảo hành 2 phía"
   ```
2. Đẩy lên repository cá nhân trên GitHub của bạn.

### Bước 2.2: Import Repository vào Vercel
1. Đăng nhập [https://vercel.com](https://vercel.com) bằng tài khoản GitHub của bạn.
2. Tại Dashboard, bấm **Add New...** > **Project**.
3. Chọn repository vừa đẩy lên và bấm **Import**.
4. Giữ nguyên cấu hình mặc định:
   - **Framework Preset**: Next.js
   - **Root Directory**: `./`

### Bước 2.3: Cấu hình Biến Môi Trường (Environment Variables)
Mở rộng phần **Environment Variables** và thêm lần lượt các biến sau (lấy từ Supabase Project Settings > API):

| Tên Biến | Phạm vi | Mô tả / Giá trị |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public (Client + Server) | URL dự án Supabase (dạng `https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (Client + Server) | Anon Key của Supabase |
| `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET` | Public (Client + Server) | Điền: `evidence-photos` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret (Chỉ Server)** | Service Role Key (tuyệt đối không bật cờ NEXT_PUBLIC) |

*(Sau khi Vercel sinh ra domain chính thức, bạn có thể bổ sung thêm `NEXT_PUBLIC_APP_URL` trỏ về domain Vercel).*

### Bước 2.4: Bấm Deploy
- Bấm nút **Deploy**. Vercel sẽ tự động build và cấp phát URL chính thức có dạng:
  👉 `https://ten-du-an-cua-ban.vercel.app`

---

## 3. Cập Nhật Cấu Hình Supabase Sau Khi Có Domain Vercel

Sau khi ứng dụng đã deploy thành công trên Vercel:
1. Đăng nhập vào trang quản trị Supabase Cloud.
2. Vào mục **Authentication** > **URL Configuration**:
   - **Site URL**: Điền URL Vercel của bạn (ví dụ: `https://ten-du-an-cua-ban.vercel.app`).
   - **Redirect URLs**: Thêm dòng `https://ten-du-an-cua-ban.vercel.app/**` và bấm **Save**.
3. Chạy file migration bảo hành (nếu chưa chạy):
   - Vào **SQL Editor** trên Supabase.
   - Mở file [`supabase/migrations/20261012000001_warranty_rpcs.sql`](file:///d:/Workspace/Personal/ws/supabase/migrations/20261012000001_warranty_rpcs.sql), dán vào và bấm **Run**.

---

## 4. Nghiệm Thu Trên Điện Thoại

1. Dùng điện thoại mở trình duyệt (Safari trên iOS hoặc Chrome trên Android) truy cập vào đường dẫn `https://ten-du-an-cua-ban.vercel.app`.
2. **Kiểm tra Camera**: Bấm vào biểu tượng Camera 📷 tại tab Tra cứu hoặc Nhập kho:
   - Trình duyệt sẽ hỏi quyền truy cập Camera. Bấm **Cho phép (Allow)**.
   - Thử quét tem mã vạch (Barcode / QR Code) trên thiết bị hoặc màn hình máy tính.
   - Kiểm tra ảnh chụp đóng khung hình và xác nhận mã.
3. **Kiểm tra Nhập kho & Xuất kho**:
   - Thử tạo 1 phiếu nhập kho với 2 thiết bị.
   - Thử tạo 1 lượt xuất bán hoặc cho mượn -> kiểm tra trừ kho và thay đổi bên giữ.
4. **Kiểm tra Bảo hành 2 phía**:
   - Tiếp nhận bảo hành -> Gửi NCC -> Nhận về -> Bàn giao trả khách.
   - Thử nhánh đổi SN mới.
5. **Kiểm tra Quyền riêng tư của Ảnh**:
   - Ảnh upload lên Supabase Storage nằm trong bucket private `evidence-photos` và chỉ hiển thị thông qua Signed URL có thời hạn, không bị lộ link công khai vĩnh viễn.

---

## 5. Giới Hạn Gói Miễn Phí Cần Lưu Ý

- **Vercel Hobby Tier**: Hoàn toàn miễn phí, băng thông 100 GB/tháng, phù hợp mục đích cá nhân.
- **Supabase Free Tier**: Cơ sở dữ liệu 500 MB, Storage 1 GB (đủ lưu trữ khoảng 4,000–5,000 ảnh nén ~200KB).
- Không cần nâng cấp bất kỳ dịch vụ trả phí nào.
