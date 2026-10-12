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

async function inspect() {
  console.log('1. Checking is_admin function...');
  const { data: adminData, error: adminErr } = await client.rpc('is_admin');
  console.log('is_admin result:', { adminData, adminErr });

  console.log('\n2. Checking table admin_users...');
  const { data: auData, error: auErr } = await client.from('admin_users').select('*');
  console.log('admin_users result:', { auData, auErr });

  console.log('\n3. Checking what functions exist in public schema via rpc error test:');
  const testFunctions = [
    'is_admin',
    'fn_check_outbound_readiness',
    'rpc_confirm_inbound_receipt',
    'rpc_confirm_outbound_receipt',
    'rpc_create_assignment',
    'rpc_return_assignment',
    'rpc_create_warranty_case',
    'rpc_transition_warranty_case',
    'rpc_replace_warranty_device',
  ];

  for (const fn of testFunctions) {
    const { error } = await client.rpc(fn, {});
    const notFound = error?.code === 'PGRST202' && error?.message?.includes('Could not find the function');
    console.log(`- ${fn}: ${notFound ? 'CHƯA CÓ (PGRST202)' : `ĐÃ CÓ (Code: ${error?.code || 'SUCCESS'} - ${error?.message})`}`);
  }
}

inspect();
