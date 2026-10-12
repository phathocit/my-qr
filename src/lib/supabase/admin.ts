import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from './server';

/**
 * Tạo Supabase Admin Client với SUPABASE_SERVICE_ROLE_KEY.
 * BẮT BUỘC kiểm tra phiên đăng nhập của người gọi trước khi trả về client.
 * Tuyệt đối không cho phép truy cập nặc danh hoặc bỏ qua auth.
 */
export async function createAdminClient() {
  const serverClient = await createServerClient();
  const { data: { user }, error } = await serverClient.auth.getUser();

  if (error || !user) {
    throw new Error('Unauthorized: Thao tác yêu cầu quyền quản trị viên đã xác thực');
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
