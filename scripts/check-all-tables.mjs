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

async function run() {
  const tables = [
    'products',
    'parties',
    'inbound_receipts',
    'inbound_items',
    'devices',
    'warranty_policies',
    'outbound_receipts',
    'outbound_items',
    'assignments',
    'warranty_cases',
    'warranty_transitions',
    'device_replacements',
    'evidence_photos',
    'pending_uploads',
    'admin_users',
    'sheets_sync_outbox',
    'sheets_model_mapping',
  ];

  console.log('=== ROW COUNTS ACROSS ALL SUPABASE TABLES ===');
  for (const t of tables) {
    const { count, error } = await client.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`${t}: ERROR ${error.code} - ${error.message}`);
    } else {
      console.log(`${t}: ${count} rows`);
    }
  }

  const { data: adminUsers, error: adminErr } = await client.from('admin_users').select('*');
  console.log('\nAdmin users in public.admin_users:', adminUsers || adminErr);

  const { data: authUsers, error: authErr } = await client.auth.admin.listUsers();
  console.log('Auth users in auth.users:', authUsers?.users?.map(u => ({ id: u.id, email: u.email, role: u.app_metadata?.role })));
}

run();
