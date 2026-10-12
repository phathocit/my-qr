import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from './server';

/**
 * Tạo Supabase Admin Client với SUPABASE_SERVICE_ROLE_KEY.
 * BẮT BUỘC kiểm tra:
 * 1. Phiên đăng nhập hợp lệ (user tồn tại).
 * 2. Người dùng phải có quyền admin (khớp ADMIN_EMAIL, ADMIN_USER_ID hoặc app_metadata.role === 'admin').
 * Tuyệt đối không cho phép user authenticated thông thường lấy client service-role.
 */
export async function createAdminClient() {
  const serverClient = await createServerClient();
  const { data: { user }, error } = await serverClient.auth.getUser();

  if (error || !user) {
    throw new Error('Unauthorized: Yêu cầu đăng nhập trước khi thực hiện thao tác');
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminUserId = process.env.ADMIN_USER_ID;
  // Kiểm tra quyền admin:
  // 1. Khớp ADMIN_USER_ID cấu hình trong env
  const isIdAdmin = Boolean(adminUserId && user.id === adminUserId);
  // 2. Khớp ADMIN_EMAIL cấu hình trong env
  const isEmailAdmin = Boolean(adminEmail && user.email === adminEmail);
  // 3. Claim role admin trong app_metadata (chỉ do Supabase Auth Admin set, không thể giả mạo từ client)
  const isRoleAdmin = user.app_metadata?.role === 'admin' || user.app_metadata?.is_admin === true;

  // 4. Kiểm tra sự tồn tại trong bảng admin_users của database
  let isDbAdmin = false;
  try {
    const { data: adminRow } = await serverClient
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    isDbAdmin = Boolean(adminRow?.user_id);
  } catch {
    isDbAdmin = false;
  }

  const hasAdminPrivilege = isIdAdmin || isEmailAdmin || isRoleAdmin || isDbAdmin;

  // TUYỆT ĐỐI KHÔNG coi mọi user authenticated là admin
  if (!hasAdminPrivilege) {
    throw new Error('Forbidden: Tài khoản người dùng không thuộc danh sách quản trị viên được cấp quyền');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Chưa cấu hình biến môi trường SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
