# Hướng Dẫn CI/CD & Quản Trị Nhánh cho Repository `phathocit/my-qr`

Tài liệu chuẩn hóa quy trình Tích hợp liên tục (CI) với GitHub Actions, Triển khai liên tục (CD) qua Vercel, quy tắc bảo vệ nhánh `main` và quy trình khôi phục (Rollback).

---

## 1. Kiến Trúc Pipeline CI/CD

```
  [Pull Request to main] ---> GitHub Actions CI (Lint, Typecheck, Unit Test, Build)
                         ---> Vercel Preview Deployment (Giao diện thử nghiệm)
                                    |
                         (Passed CI & Manual Review)
                                    v
     [Merge to main]     ---> Vercel Production Deployment (Tự động kích hoạt)
```

- **GitHub Actions CI** (`.github/workflows/ci.yml`):
  - Kích hoạt khi: Có `pull_request` tạo vào `main` HOẶC khi có `push` vào `main`.
  - Quyền hạn tối thiểu: `contents: read`.
  - Các bước thực thi trên `ubuntu-latest`:
    1. Cài đặt phụ thuộc với `npm ci` và cache package manager.
    2. Kiểm tra cú pháp và quy chuẩn mã với `npm run lint`.
    3. Kiểm tra kiểu tĩnh với `npx tsc --noEmit`.
    4. Chạy bộ unit test quy tắc nghiệp vụ với `npm test`.
    5. Kiểm tra đóng gói `npm run build` sử dụng biến môi trường giả lập (Dummy environment variables) hoàn toàn độc lập, không kết nối database thật.
- **Vercel CD (Native Git Integration)**:
  - Vercel kết nối trực tiếp với GitHub qua GitHub App.
  - Nhánh `main`: Tự động deploy lên **Production** (`https://ten-du-an.vercel.app`).
  - Các nhánh khác / Pull Request: Tự động deploy bản **Preview** (`https://ten-du-an-git-branch.vercel.app`).

---

## 2. Cách Ly Môi Trường Preview & Production

- **Bảo vệ dữ liệu thật**:
  - Không cấu hình URL và Service-role key của Supabase Production vào môi trường Preview nếu chưa có project Supabase dev riêng.
  - Môi trường Preview phục vụ kiểm tra giao diện, độ mượt của camera và UX/UI mobile-first.
  - Khi chưa cấu hình Supabase cho Preview, ứng dụng hiển thị thông báo rõ ràng *"Demo Local (Mock)"* để người kiểm thử không thao tác nhầm vào dữ liệu thật.

---

## 3. Hướng Dẫn Cấu Hình Bảo Vệ Nhánh `main` (Branch Protection)

Do repository là tài khoản cá nhân, bạn thao tác trực tiếp trên giao diện web GitHub:

1. Truy cập: [https://github.com/phathocit/my-qr/settings/branches](https://github.com/phathocit/my-qr/settings/branches).
2. Bấm **Add branch protection rule** (hoặc **Add ruleset**):
   - **Branch name pattern**: `main`
   - Tích chọn:
     - ☑️ **Require a pull request before merging**: Yêu cầu phải tạo PR để merge vào main.
       - *(Đối với repo cá nhân một người, KHÔNG tích chọn "Require approvals" để không bị chặn bởi người thứ 2)*.
     - ☑️ **Require status checks to pass before merging**:
       - Tìm và chọn check: `Test & Build` (hoặc tên job `ci`).
       - Bật tùy chọn *Require branches to be up to date before merging*.
     - ☑️ **Do not allow bypassing the above settings**: Ngăn chặn bỏ qua kiểm tra trừ quản trị viên.
     - ☑️ **Lock branch**: Tắt tùy chọn force push (`Allow force pushes` để trống) và xóa nhánh (`Allow deletions` để trống).
3. Bấm **Save changes**.

> [!NOTE]
> Khi bật quy tắc này, Vercel Production Deployment chỉ được kích hoạt sau khi Pull Request đã vượt qua toàn bộ các kiểm tra của GitHub Actions CI.

---

## 4. Quản Lý Migration Database

- **Tách biệt với code deployment**:
  - CI chỉ kiểm tra biên dịch và test logic mã nguồn; CI không tự động chạy lệnh DDL/DML lên database production.
  - Mọi thay đổi schema phải được viết thành file SQL trong thư mục `supabase/migrations/` và review cùng PR.
- **Quy tắc Backward Compatibility (Tương thích ngược)**:
  - Migration phải được áp dụng lên Supabase Production **TRƯỚC** khi merge code phụ thuộc nó vào `main`.
  - Nếu có thay đổi cấu trúc lớn (ví dụ đổi tên cột, xóa cột): Luôn chia thành 2 giai đoạn (Giai đoạn 1: thêm cột mới hỗ trợ song song; Giai đoạn 2: chuyển đổi dữ liệu và dọn cột cũ sau khi code mới đã chạy ổn định).

---

## 5. Quy Trình Khôi Phục Nhanh (Rollback)

Khi phát sinh sự cố khẩn cấp trên Production:

1. **Rollback ứng dụng trên Vercel (Dưới 30 giây)**:
   - Truy cập Vercel Dashboard > **Deployments**.
   - Tìm bản deployment hoạt động ổn định gần nhất trước đó.
   - Bấm vào menu ba chấm `...` > Chọn **Promote to Production**.
   - Vercel sẽ ngay lập tức trỏ lưu lượng truy cập về bản build cũ mà không cần chờ build lại.
2. **Lưu ý về Database Rollback**:
   - Thao tác Rollback trên Vercel **KHÔNG** tự động rollback dữ liệu hay cấu trúc bảng trong Supabase.
   - Do đó, luôn sao lưu snapshot database trước khi áp dụng các migration có rủi ro cao:
     ```bash
     pg_dump -h db.<PROJECT_REF>.supabase.co -U postgres -d postgres -F c -b -f backup_truoc_khi_migration.dump
     ```
