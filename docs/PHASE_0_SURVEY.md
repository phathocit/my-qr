# Giai đoạn 0: Khảo sát Hiện trạng & Kế hoạch Triển khai

## 1. Kết quả kiểm tra hiện trạng workspace
- Thư mục làm việc: `d:\Workspace\Personal\ws` (trống, chưa có mã nguồn hoặc cấu hình hạ tầng).
- Môi trường máy chủ dev cục bộ:
  - Hệ điều hành: Windows
  - Node.js: `v24.18.0`, npm: `11.16.0`
  - Docker: `26.1.1`

---

## 2. Đặc tả nghiệp vụ & Kiến trúc dữ liệu
Đặc tả chi tiết toàn bộ các thực thể, quan hệ, bảng chuyển trạng thái, điều kiện sẵn sàng xuất và các kịch bản nghiệm thu đã được hoàn thiện tại:
👉 **[SPEC.md](file:///d:/Workspace/Personal/ws/docs/SPEC.md)**

Tóm tắt các điểm đã thống nhất:
1. **Tách trạng thái thành các chiều trực giao**:
   - `ownership` (`INTERNAL` / `EXTERNAL`), liên kết `parties`.
   - `custody` / bên đang giữ (`INTERNAL_STORAGE`, `EXTERNAL_PARTY`, `SUPPLIER_WARRANTY`), liên kết `parties`.
   - `technical_condition` (`USABLE`, `NEEDS_INSPECTION`, `FAULTY`).
   - `lifecycle` (`ACTIVE`, `REPLACED`, `RETURNED_SUPPLIER`).
   - Giao sử dụng biểu diễn bằng bản ghi `assignments` (`LOAN` / `LONG_TERM_ASSIGNMENT`).
   - Bảo hành biểu diễn bằng hồ sơ `warranty_cases` đang mở.
2. **Điều kiện sẵn sàng xuất kho tập trung (Backend)**:
   - Thuộc `INTERNAL`, đang ở `INTERNAL_STORAGE`, `lifecycle = ACTIVE`, `technical_condition = USABLE`, không có `assignments` mở và không có `warranty_cases` mở.
3. **Chính sách & Hồ sơ bảo hành**:
   - Tách riêng chính sách NCC (`warranty_policies` nguồn nhập) và chính sách khách (`warranty_policies` nguồn xuất).
   - Hồ sơ bảo hành lưu snapshot của 2 chính sách tại thời điểm tiếp nhận.
   - Hỗ trợ các nhánh ngoại lệ (sửa tại chỗ chờ trả khách; NCC từ chối sửa nhận về trả khách).
   - Đổi SN: Chuyển máy cũ sang `REPLACED`, tạo/liên kết máy mới, kế thừa quyền sở hữu theo giao dịch, không tự nhập thành hàng sẵn sàng bán.
4. **Bằng chứng ảnh & Upload đệm**:
   - Phân biệt ảnh nguồn được lưu và bản hiển thị có watermark.
   - Upload đệm (`pending_uploads`) có cơ chế dọn file bỏ dở để tránh rác lưu trữ.

---

## 3. Câu hỏi chặn tiến độ cần chủ dự án xác nhận hạ tầng
Để chọn đúng một phương án và bắt đầu khởi tạo mã nguồn, cần thông tin về hạ tầng của bạn:
1. **Tech Stack**: Fullstack Next.js (App Router) hay Backend Express + Frontend Vite React?
2. **Database có sẵn**: SQLite (chạy trong volume/file), PostgreSQL, hay MySQL?
3. **Nơi lưu trữ ảnh**: Thư mục cục bộ / Docker Volume hay dịch vụ S3 / MinIO có sẵn?
4. **Phương thức Deploy**: Docker Compose hay tiến trình Node.js / PM2?
5. **Cơ chế Auth**: Đăng nhập mật khẩu đơn giản (Admin session/cookie) hay có hệ thống Auth riêng?
