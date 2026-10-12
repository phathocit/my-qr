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

async function seedInitialData() {
  console.log('=== NẠP DANH MỤC KHỞI TẠO CHO SUPABASE CLOUD ===\n');

  // 1. Danh sách Nhà cung cấp & Khách hàng mẫu
  const sampleParties = [
    { name: 'Synnex FPT Distribution', type: 'SUPPLIER', phone: '02473006666', email: 'contact@synnexfpt.com' },
    { name: 'Digiworld (DGW)', type: 'SUPPLIER', phone: '02839290059', email: 'info@digiworld.com.vn' },
    { name: 'Công ty Viễn Sơn', type: 'SUPPLIER', phone: '02838326085', email: 'sales@microstar.com.vn' },
    { name: 'Công ty CP Công Nghệ Á Châu', type: 'CUSTOMER_ORG', phone: '0901234567', email: 'contact@achau.vn' },
    { name: 'Nguyễn Văn An (Trưởng phòng IT)', type: 'INTERNAL_MEMBER', phone: '0988776655', email: 'an.nguyen@phathocit.id.vn' },
    { name: 'Trần Thị Mai (Kế toán)', type: 'INTERNAL_MEMBER', phone: '0977665544', email: 'mai.tran@phathocit.id.vn' },
    { name: 'Khách lẻ - Lê Hoàng Quân', type: 'CUSTOMER_INDIVIDUAL', phone: '0933221100', email: 'quan.le@gmail.com' },
  ];

  console.log('1. Đang nạp danh sách Đối tác & Nhà cung cấp...');
  for (const party of sampleParties) {
    const { data: existing } = await client.from('parties').select('id').eq('name', party.name).maybeSingle();
    if (!existing) {
      const { error } = await client.from('parties').insert(party);
      if (error) console.warn('Lỗi nạp party:', party.name, error.message);
      else console.log(`✔ Đã thêm: [${party.type}] ${party.name}`);
    } else {
      console.log(`ℹ Đã có sẵn: [${party.type}] ${party.name}`);
    }
  }

  // 2. Danh sách Dòng sản phẩm mẫu
  const sampleProducts = [
    { name: 'Latitude 5440 (Core i5, 16GB, 512GB)', brand: 'Dell', category: 'Laptop' },
    { name: 'ThinkPad T14 Gen 4 (Ryzen 7, 32GB)', brand: 'Lenovo', category: 'Laptop' },
    { name: 'MacBook Pro 14 M3 Pro (18GB, 512GB)', brand: 'Apple', category: 'Laptop' },
    { name: 'Màn hình UltraSharp U2422H 24" FHD', brand: 'Dell', category: 'Monitor' },
    { name: 'Chuột không dây MX Master 3S', brand: 'Logitech', category: 'Accessories' },
    { name: 'Bàn phím cơ không dây K2 Pro', brand: 'Keychron', category: 'Accessories' },
    { name: 'Máy in Laser đa năng LaserJet Pro M428fdw', brand: 'HP', category: 'Printer' },
  ];

  console.log('\n2. Đang nạp danh sách Dòng sản phẩm...');
  for (const prod of sampleProducts) {
    const { data: existing } = await client.from('products').select('id').eq('name', prod.name).maybeSingle();
    if (!existing) {
      const { error } = await client.from('products').insert(prod);
      if (error) console.warn('Lỗi nạp product:', prod.name, error.message);
      else console.log(`✔ Đã thêm: [${prod.brand}] ${prod.name}`);
    } else {
      console.log(`ℹ Đã có sẵn: [${prod.brand}] ${prod.name}`);
    }
  }

  console.log('\n=== HOÀN TẤT NẠP DỮ LIỆU KHỞI TẠO! ===');
}

seedInitialData().catch(console.error);
