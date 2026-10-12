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

async function check() {
  const { data: prods } = await client.from('products').select('id, name, brand, category');
  const { data: parties } = await client.from('parties').select('id, name, type');
  const { data: devs } = await client.from('devices').select('id, management_code, serial_number, lifecycle');

  console.log('=== HIỆN TRẠNG DỮ LIỆU TRÊN SUPABASE CLOUD ===');
  console.log('Sản phẩm (Products):', prods);
  console.log('Đối tác (Parties):', parties);
  console.log('Thiết bị (Devices):', devs);
}

check();
