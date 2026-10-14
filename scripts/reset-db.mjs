import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// 1. Đọc biến môi trường từ .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
const content = fs.readFileSync(envPath, 'utf8');
content.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx !== -1) {
    process.env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
  }
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Thiếu cấu hình NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local');
  process.exit(1);
}

const client = createClient(supabaseUrl, serviceRoleKey);

async function resetDatabase() {
  console.log('====================================================');
  console.log('   BẮT ĐẦU RESET TOÀN BỘ CƠ SỞ DỮ LIỆU TỒN KHO');
  console.log('====================================================\n');

  // Kiểm tra tài khoản admin trước
  const { data: adminList } = await client.from('admin_users').select('*');
  console.log('Tài khoản Admin được bảo vệ:', adminList);

  // 1. Dọn dẹp bucket storage 'evidence-photos'
  console.log('\n--- 1. Xóa toàn bộ ảnh trong Supabase Storage: evidence-photos ---');
  try {
    const { data: files, error: listErr } = await client.storage.from('evidence-photos').list('', { limit: 100 });
    if (listErr) {
      console.warn('Lỗi khi liệt kê bucket evidence-photos:', listErr.message);
    } else if (files && files.length > 0) {
      const filePaths = files.map(f => f.name);
      console.log(`Tìm thấy ${filePaths.length} file trong storage:`, filePaths);
      const { error: delErr } = await client.storage.from('evidence-photos').remove(filePaths);
      if (delErr) console.warn('Lỗi khi xóa file storage:', delErr.message);
      else console.log('✔ Đã xóa sạch file trong storage');
    } else {
      console.log('✔ Không có file nào trong storage');
    }
  } catch (err) {
    console.warn('Bỏ qua lỗi storage:', err.message);
  }

  // Thứ tự xóa bảng theo thứ tự quan hệ khóa ngoại (Foreign Keys)
  const tablesToClear = [
    { name: 'evidence_photos', label: 'Bằng chứng ảnh' },
    { name: 'device_replacements', label: 'Bản ghi đổi máy bảo hành' },
    { name: 'warranty_transitions', label: 'Lịch sử chuyển bước bảo hành' },
    { name: 'warranty_cases', label: 'Hồ sơ bảo hành' },
    { name: 'assignments', label: 'Bàn giao / Cho mượn' },
    { name: 'outbound_items', label: 'Chi tiết phiếu xuất kho' },
    { name: 'outbound_receipts', label: 'Phiếu xuất kho' },
    { name: 'warranty_policies', label: 'Chính sách bảo hành' },
    { name: 'devices', label: 'Thiết bị tồn kho' },
    { name: 'inbound_items', label: 'Chi tiết phiếu nhập' },
    { name: 'inbound_receipts', label: 'Phiếu nhập kho' },
    { name: 'sheets_sync_outbox', label: 'Hàng đợi Google Sheets Outbox' },
    { name: 'sheets_model_mapping', label: 'Mapping Tab Google Sheets' },
    { name: 'products', label: 'Danh mục sản phẩm / Model' },
    { name: 'parties', label: 'Danh sách đối tác / NCC / Khách / NV' },
    { name: 'pending_uploads', label: 'File upload tạm' },
  ];

  console.log('\n--- 2. Tiến hành xóa dữ liệu các bảng nghiệp vụ ---');
  for (const t of tablesToClear) {
    try {
      // Dùng cú pháp .delete().neq('id', '00000000-0000-0000-0000-000000000000') để xóa tất cả các dòng
      const { error, count } = await client
        .from(t.name)
        .delete({ count: 'exact' })
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (error) {
        // Trường hợp bảng không có id UUID (ví dụ composite key hoặc khác)
        const { error: fallbackErr } = await client.from(t.name).delete().not('created_at', 'is', null);
        if (fallbackErr) {
          console.error(`❌ Lỗi khi xóa bảng ${t.name}:`, error.message, fallbackErr.message);
        } else {
          console.log(`✔ [${t.name}] (${t.label}): Đã xóa sạch (fallback mode)`);
        }
      } else {
        console.log(`✔ [${t.name}] (${t.label}): Đã xóa ${count ?? 0} dòng`);
      }
    } catch (e) {
      console.error(`❌ Ngoại lệ bảng ${t.name}:`, e.message);
    }
  }

  // 3. Đảm bảo tài khoản Admin vẫn nguyên vẹn
  console.log('\n--- 3. Kiểm tra và xác nhận quyền Admin ---');
  const adminId = 'a794ba5d-563d-4c62-ab7f-e2daf7a186a0';
  const adminEmail = 'hatranduyphat2004@gmail.com';

  await client.auth.admin.updateUserById(adminId, {
    app_metadata: { role: 'admin' }
  });

  await client.from('admin_users').upsert({
    user_id: adminId,
    email: adminEmail,
  });

  // 4. Kiểm tra số lượng dòng còn lại sau reset
  console.log('\n====================================================');
  console.log('   KẾT QUẢ KIỂM TRA SAU KHI RESET DB');
  console.log('====================================================');

  for (const t of tablesToClear) {
    const { count } = await client.from(t.name).select('*', { count: 'exact', head: true });
    console.log(`- ${t.name.padEnd(24)}: ${count ?? 0} dòng`);
  }

  const { data: finalAdmins } = await client.from('admin_users').select('*');
  console.log(`- ${'admin_users'.padEnd(24)}: ${finalAdmins?.length ?? 0} dòng (${finalAdmins?.[0]?.email})`);

  console.log('\n✔ ĐÃ HOÀN TẤT RESET CƠ SỞ DỮ LIỆU THÀNH CÔNG!');
}

resetDatabase().catch(err => {
  console.error('Lỗi nghiêm trọng:', err);
  process.exit(1);
});
