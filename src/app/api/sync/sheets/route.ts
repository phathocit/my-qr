import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isGoogleSheetsConfigured, googleSheetsService } from '@/lib/googleSheetsService';
import { Product, Device } from '@/types/database';

function isFatalGoogleError(err: any): boolean {
  const status = err?.status || err?.code || err?.response?.status;
  // 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found là lỗi cấu hình / quyền hạn -> Không retry vô tận
  return status === 400 || status === 401 || status === 403 || status === 404;
}

export async function GET() {
  try {
    const configured = isGoogleSheetsConfigured();
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const maskedSpreadsheetId = spreadsheetId
      ? `${spreadsheetId.slice(0, 6)}...${spreadsheetId.slice(-4)}`
      : null;

    let outboxStats = {
      pending: 0,
      processing: 0,
      success: 0,
      failed: 0,
      fatal_error: 0,
      total: 0,
    };
    let recentErrors: any[] = [];

    // Cố gắng đọc trạng thái outbox từ DB nếu có cấu hình
    try {
      const serverClient = await createClient();
      const { data: rows } = await serverClient
        .from('sheets_sync_outbox')
        .select('id, entity_type, entity_id, status, retry_count, next_retry_at, last_error, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (rows && rows.length > 0) {
        outboxStats.total = rows.length;
        rows.forEach((r) => {
          if (r.status === 'PENDING') outboxStats.pending++;
          else if (r.status === 'PROCESSING') outboxStats.processing++;
          else if (r.status === 'SUCCESS') outboxStats.success++;
          else if (r.status === 'FAILED') outboxStats.failed++;
          else if (r.status === 'FATAL_ERROR') outboxStats.fatal_error++;
        });

        recentErrors = rows
          .filter((r) => r.status === 'FAILED' || r.status === 'FATAL_ERROR')
          .slice(0, 5);
      }
    } catch {
      // Bảng chưa có trong migration hoặc môi trường dev local
    }

    return NextResponse.json({
      success: true,
      configured,
      spreadsheetId: maskedSpreadsheetId,
      serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null,
      outboxStats,
      recentErrors,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Lỗi khi kiểm tra trạng thái Google Sheets' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    // 1. Xác thực quyền Admin
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isCronAuthorized = cronSecret && authHeader === `Bearer ${cronSecret}`;

    let adminClient: any = null;
    if (!isCronAuthorized) {
      adminClient = await createAdminClient();
    } else {
      const { createClient: createServiceClient } = await import('@supabase/supabase-js');
      adminClient = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
    }

    if (!isGoogleSheetsConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Chưa cấu hình biến môi trường Google Sheets (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEETS_SPREADSHEET_ID)',
        },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') || 'sync_pending';

    // 2. Action: Đối soát toàn bộ Danh mục (Reconcile Catalog)
    if (action === 'reconcile_catalog') {
      const [prodsRes, devsRes] = await Promise.all([
        adminClient.from('products').select('*'),
        adminClient.from('devices').select('id, product_id, lifecycle'),
      ]);

      if (prodsRes.error) throw prodsRes.error;
      const products: Product[] = prodsRes.data || [];
      const devices: Device[] = devsRes.data || [];

      const result = await googleSheetsService.reconcileCatalog(products, devices);

      return NextResponse.json({
        success: true,
        message: `Đã đối soát xong tab Danh mục: ${result.totalProducts} dòng sản phẩm (${result.updatedCount} cập nhật, ${result.appendedCount} thêm mới).`,
        result,
      });
    }

    // 3. Action: Đối soát các Tab Model (Reconcile Model Tabs)
    if (action === 'reconcile_model_tabs') {
      const [prodsRes, devsRes] = await Promise.all([
        adminClient.from('products').select('*'),
        adminClient.from('devices').select(`
          *,
          product:products(*),
          owner_party:parties!owner_party_id(*),
          holder_party:parties!holder_party_id(*),
          warranty_policies:warranty_policies(*)
        `),
      ]);

      if (prodsRes.error) throw prodsRes.error;
      if (devsRes.error) throw devsRes.error;

      const products: Product[] = prodsRes.data || [];
      const rawDevices: any[] = devsRes.data || [];

      const devices: Device[] = rawDevices.map((dev: any) => {
        const enriched = { ...dev };
        if (dev.warranty_policies && Array.isArray(dev.warranty_policies)) {
          enriched.supplier_warranty = dev.warranty_policies.find((p: any) => p.policy_type === 'SUPPLIER_POLICY') || null;
          enriched.customer_warranty = dev.warranty_policies.find((p: any) => p.policy_type === 'CUSTOMER_POLICY') || null;
        }
        return enriched;
      });

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const result = await googleSheetsService.reconcileModelTabs(products, devices, appUrl);

      return NextResponse.json({
        success: true,
        message: `Đã đối soát xong các tab Model: ${result.totalModels} dòng sản phẩm, ${result.totalDevices} thiết bị (${result.updatedCount} cập nhật, ${result.appendedCount} thêm mới).`,
        result,
      });
    }

    // 4. Action: Đối soát Tab Bảo hành (Reconcile Warranty)
    if (action === 'reconcile_warranty') {
      const { data: rawCases, error: caseErr } = await adminClient
        .from('warranty_cases')
        .select(`
          *,
          device:devices(*),
          customer:parties!customer_id(*)
        `)
        .order('created_at', { ascending: false });

      if (caseErr) throw caseErr;

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const result = await googleSheetsService.reconcileWarrantySheet(rawCases || [], appUrl);

      return NextResponse.json({
        success: true,
        message: `Đã đối soát xong tab Bảo hành: ${result.totalCases} hồ sơ (${result.updatedCount} cập nhật, ${result.appendedCount} thêm mới).`,
        result,
      });
    }

    // 5. Action: Reset retry cho các job lỗi (Retry Failed)
    if (action === 'retry_failed') {
      const { error: resetErr } = await adminClient
        .from('sheets_sync_outbox')
        .update({
          status: 'PENDING',
          next_retry_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('status', 'FAILED');

      if (resetErr) throw resetErr;

      return NextResponse.json({
        success: true,
        message: 'Đã đặt lại thời gian retry cho các job thất bại.',
      });
    }

    // 5. Action mặc định: Đồng bộ các job đang chờ trong Outbox (Lease / Claim)
    const workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let claimedJobs: any[] = [];

    // Cố gắng claim qua RPC
    const { data: rpcJobs, error: rpcErr } = await adminClient.rpc('rpc_claim_sheets_outbox_jobs', {
      p_worker_id: workerId,
      p_batch_size: 15,
    });

    if (!rpcErr && Array.isArray(rpcJobs)) {
      claimedJobs = rpcJobs;
    } else {
      // Fallback nếu RPC chưa tồn tại: select và update thủ công
      const nowIso = new Date().toISOString();
      const { data: rawJobs } = await adminClient
        .from('sheets_sync_outbox')
        .select('*')
        .or(`status.eq.PENDING,and(status.eq.FAILED,retry_count.lt.5,next_retry_at.lte.${nowIso})`)
        .order('created_at', { ascending: true })
        .limit(15);

      if (rawJobs && rawJobs.length > 0) {
        const jobIds = rawJobs.map((j: any) => j.id);
        await adminClient
          .from('sheets_sync_outbox')
          .update({ status: 'PROCESSING', locked_at: nowIso, locked_by: workerId })
          .in('id', jobIds);
        claimedJobs = rawJobs;
      }
    }

    if (claimedJobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Hàng đợi Outbox hiện không có job nào cần xử lý.',
        processedCount: 0,
      });
    }

    let successCount = 0;
    let failedCount = 0;

    for (const job of claimedJobs) {
      try {
        if (job.entity_type === 'CATALOG') {
          // Lấy thông tin product
          const { data: prod } = await adminClient
            .from('products')
            .select('*')
            .eq('id', job.entity_id)
            .single();

          if (!prod) {
            // Product đã bị xóa hoặc không tìm thấy
            await adminClient
              .from('sheets_sync_outbox')
              .update({ status: 'SUCCESS', updated_at: new Date().toISOString() })
              .eq('id', job.id);
            continue;
          }

          // Đếm số lượng máy active của product này
          const { count } = await adminClient
            .from('devices')
            .select('*', { count: 'exact', head: true })
            .eq('product_id', prod.id)
            .eq('lifecycle', 'ACTIVE');

          await googleSheetsService.syncCatalogItem({
            product: prod,
            activeDeviceCount: count || 0,
          });

          // Hoàn tất job thành công
          await adminClient.rpc('rpc_finish_sheets_outbox_job', {
            p_job_id: job.id,
            p_success: true,
          }).catch(async () => {
            await adminClient
              .from('sheets_sync_outbox')
              .update({ status: 'SUCCESS', locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
              .eq('id', job.id);
          });

          successCount++;
        } else if (job.entity_type === 'DEVICE') {
          // Lấy thông tin chi tiết thiết bị kèm product và chính sách bảo hành
          const { data: rawDev, error: devErr } = await adminClient
            .from('devices')
            .select(`
              *,
              product:products(*),
              owner_party:parties!owner_party_id(*),
              holder_party:parties!holder_party_id(*),
              warranty_policies:warranty_policies(*)
            `)
            .eq('id', job.entity_id)
            .single();

          if (devErr || !rawDev) {
            // Thiết bị đã bị xóa hoặc không tìm thấy
            await adminClient
              .from('sheets_sync_outbox')
              .update({ status: 'SUCCESS', updated_at: new Date().toISOString() })
              .eq('id', job.id);
            continue;
          }

          const dev: Device = { ...rawDev };
          if (rawDev.warranty_policies && Array.isArray(rawDev.warranty_policies)) {
            dev.supplier_warranty = rawDev.warranty_policies.find((p: any) => p.policy_type === 'SUPPLIER_POLICY') || null;
            dev.customer_warranty = rawDev.warranty_policies.find((p: any) => p.policy_type === 'CUSTOMER_POLICY') || null;
          }

          const product = dev.product;
          if (!product) {
            throw new Error(`Không tìm thấy dòng sản phẩm cho thiết bị ${dev.management_code}`);
          }

          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
          await googleSheetsService.syncDeviceItem({
            device: dev,
            product,
            appUrl,
          });

          // Hoàn tất job thành công
          await adminClient.rpc('rpc_finish_sheets_outbox_job', {
            p_job_id: job.id,
            p_success: true,
          }).catch(async () => {
            await adminClient
              .from('sheets_sync_outbox')
              .update({ status: 'SUCCESS', locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
              .eq('id', job.id);
          });

          successCount++;
        } else if (job.entity_type === 'WARRANTY_CASE') {
          // Lấy thông tin hồ sơ bảo hành kèm thiết bị
          const { data: rawCase, error: caseErr } = await adminClient
            .from('warranty_cases')
            .select(`
              *,
              device:devices(*)
            `)
            .eq('id', job.entity_id)
            .single();

          if (caseErr || !rawCase) {
            // Ca bảo hành đã bị xóa hoặc không tìm thấy
            await adminClient
              .from('sheets_sync_outbox')
              .update({ status: 'SUCCESS', updated_at: new Date().toISOString() })
              .eq('id', job.id);
            continue;
          }

          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
          await googleSheetsService.syncWarrantyCaseItem({
            warrantyCase: rawCase,
            appUrl,
          });

          // Hoàn tất job thành công
          await adminClient.rpc('rpc_finish_sheets_outbox_job', {
            p_job_id: job.id,
            p_success: true,
          }).catch(async () => {
            await adminClient
              .from('sheets_sync_outbox')
              .update({ status: 'SUCCESS', locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
              .eq('id', job.id);
          });

          successCount++;
        }
      } catch (jobErr: any) {
        failedCount++;
        const isFatal = isFatalGoogleError(jobErr);
        const errMsg = jobErr?.message || 'Lỗi khi gọi Google Sheets API';

        await adminClient.rpc('rpc_finish_sheets_outbox_job', {
          p_job_id: job.id,
          p_success: false,
          p_is_fatal: isFatal,
          p_error_message: errMsg,
        }).catch(async () => {
          const nextRetry = new Date(Date.now() + Math.pow(2, (job.retry_count || 0) + 1) * 30000).toISOString();
          await adminClient
            .from('sheets_sync_outbox')
            .update({
              status: isFatal ? 'FATAL_ERROR' : 'FAILED',
              retry_count: (job.retry_count || 0) + 1,
              next_retry_at: nextRetry,
              last_error: errMsg,
              locked_at: null,
              locked_by: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id);
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Đã xử lý ${claimedJobs.length} jobs: ${successCount} thành công, ${failedCount} lỗi.`,
      claimedCount: claimedJobs.length,
      successCount,
      failedCount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Lỗi hệ thống khi xử lý đồng bộ Google Sheets' },
      { status: 500 }
    );
  }
}
