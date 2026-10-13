import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// In-memory brute force & rate limiting tracker
interface AttemptRecord {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

const loginAttempts = new Map<string, AttemptRecord>();

// Cleanup stale records periodically
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupStaleRecords() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, record] of loginAttempts.entries()) {
    if (now > record.lockedUntil && now - record.firstAttemptAt > 60 * 60 * 1000) {
      loginAttempts.delete(key);
    }
  }
}

// Timing-safe constant-time comparison using SHA-256
function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// Rate limiting settings: 5 failed attempts -> 15 min lock
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const WINDOW_DURATION_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  cleanupStaleRecords();

  try {
    // 1. Get client IP for rate limiting
    const forwardedFor = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip');
    const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || 'unknown-ip');

    const body = await req.json().catch(() => ({}));
    const { email, password, honeypot } = body;

    // 2. Anti-bot honeypot check
    if (honeypot) {
      console.warn(`[SECURITY ALERT] Honeypot triggered from IP: ${clientIp}`);
      await new Promise((r) => setTimeout(r, 1000));
      return NextResponse.json(
        { error: 'Yêu cầu không hợp lệ' },
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        }
      );
    }

    const normalizedEmail = (email || '').trim().toLowerCase();
    const rateLimitKey = `${clientIp}:${normalizedEmail || 'anonymous'}`;
    const now = Date.now();

    // 3. Check existing lockout
    const record = loginAttempts.get(rateLimitKey);
    if (record && record.lockedUntil > now) {
      const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
      const remainingMinutes = Math.ceil(remainingSeconds / 60);
      console.warn(`[SECURITY ALERT] Blocked request from locked IP/account: ${rateLimitKey} (${remainingSeconds}s remaining)`);
      return NextResponse.json(
        {
          error: `Tài khoản đã bị tạm khóa do nhập sai nhiều lần. Vui lòng thử lại sau ${remainingMinutes} phút.`,
          retryAfter: remainingSeconds,
          locked: true,
        },
        {
          status: 429,
          headers: {
            'Retry-After': remainingSeconds.toString(),
            'Cache-Control': 'no-store, max-age=0',
          },
        }
      );
    }

    // 4. Validate input existence
    if (!normalizedEmail || !password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Vui lòng cung cấp đầy đủ email và mật khẩu' },
        { status: 400 }
      );
    }

    const adminEmail = process.env.ADMIN_EMAIL || 'hatranduyphat2004@gmail.com';
    const expectedPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';

    // 5. Timing-safe verification against timing attacks
    const emailMatches = timingSafeCompare(normalizedEmail, adminEmail.toLowerCase().trim());
    const passwordMatches = timingSafeCompare(password, expectedPassword);

    if (!emailMatches || !passwordMatches) {
      // Record failed attempt
      const existing = loginAttempts.get(rateLimitKey);
      let attempts = 1;
      let lockedUntil = 0;

      if (existing) {
        if (now - existing.firstAttemptAt < WINDOW_DURATION_MS) {
          attempts = existing.attempts + 1;
        } else {
          attempts = 1;
        }
      }

      if (attempts >= MAX_FAILED_ATTEMPTS) {
        lockedUntil = now + LOCKOUT_DURATION_MS;
        console.warn(`[SECURITY ALERT] Lockout activated for: ${rateLimitKey} (5 failed attempts)`);
      } else {
        console.warn(`[SECURITY WARNING] Failed login attempt #${attempts} from IP: ${clientIp}`);
      }

      loginAttempts.set(rateLimitKey, {
        attempts,
        firstAttemptAt: existing && now - existing.firstAttemptAt < WINDOW_DURATION_MS ? existing.firstAttemptAt : now,
        lockedUntil,
      });

      // Tarpit delay to mitigate automated dictionary attacks
      await new Promise((r) => setTimeout(r, 800));

      if (lockedUntil > 0) {
        const remainingSeconds = Math.ceil(LOCKOUT_DURATION_MS / 1000);
        return NextResponse.json(
          {
            error: `Đăng nhập thất bại quá 5 lần. Hệ thống đã tạm khóa tài khoản trong 15 phút để bảo vệ an toàn.`,
            retryAfter: remainingSeconds,
            locked: true,
          },
          {
            status: 429,
            headers: {
              'Retry-After': remainingSeconds.toString(),
              'Cache-Control': 'no-store, max-age=0',
            },
          }
        );
      }

      const remaining = MAX_FAILED_ATTEMPTS - attempts;
      return NextResponse.json(
        {
          error: `Email hoặc mật khẩu không chính xác (còn ${remaining} lần thử trước khi bị khóa tạm thời)`,
          remainingAttempts: remaining,
        },
        {
          status: 401,
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        }
      );
    }

    // 6. Reset rate limit counter on success
    loginAttempts.delete(rateLimitKey);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: 'Chưa cấu hình Supabase Server Role Key' },
        { status: 500 }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // 7. Generate magiclink safely from server-side
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

    console.info(`[SECURITY AUDIT] Admin login successful for ${adminEmail} from IP: ${clientIp}`);

    return NextResponse.json(
      {
        success: true,
        token_hash: linkData.properties.hashed_token,
        email: adminEmail,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Lỗi hệ thống khi xử lý đăng nhập' },
      { status: 500 }
    );
  }
}
