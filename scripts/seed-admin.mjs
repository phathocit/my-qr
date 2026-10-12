import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

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

const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function seed() {
  const adminId = 'a794ba5d-563d-4c62-ab7f-e2daf7a186a0';
  const adminEmail = 'hatranduyphat2004@gmail.com';

  console.log('1. Cập nhật app_metadata role=admin cho tài khoản:', adminEmail);
  const { error: metaErr } = await client.auth.admin.updateUserById(adminId, {
    app_metadata: { role: 'admin' }
  });
  if (metaErr) console.error('Lỗi cập nhật app_metadata:', metaErr);
  else console.log('✔ Cập nhật app_metadata thành công!');

  console.log('2. Thêm vào bảng public.admin_users...');
  const { error: dbErr } = await client.from('admin_users').upsert({
    user_id: adminId,
    email: adminEmail,
  });
  if (dbErr) console.error('Lỗi thêm vào admin_users:', dbErr);
  else console.log('✔ Đã cấp quyền trong bảng admin_users thành công!');

  console.log('3. Kiểm tra lại bảng admin_users:');
  const { data: rows } = await client.from('admin_users').select('*');
  console.log('Bảng admin_users hiện tại:', rows);
}

seed();
