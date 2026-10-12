import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    const adminEmail = process.env.ADMIN_EMAIL || 'hatranduyphat2004@gmail.com';
    const expectedPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';

    const normalizedEmail = (email || '').trim().toLowerCase();

    // 1. Kiểm tra tài khoản & mật khẩu admin
    if (normalizedEmail !== adminEmail.toLowerCase() || password !== expectedPassword) {
      return NextResponse.json(
        { error: 'Email hoặc mật khẩu quản trị không chính xác' },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: 'Chưa cấu hình Supabase Server Role Key' },
        { status: 500 }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // 2. Tạo link đăng nhập an toàn từ server-side
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: adminEmail,
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      return NextResponse.json(
        { error: linkError?.message || 'Không thể tạo phiên xác thực' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      token_hash: linkData.properties.hashed_token,
      email: adminEmail,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Lỗi hệ thống khi xử lý đăng nhập' },
      { status: 500 }
    );
  }
}
