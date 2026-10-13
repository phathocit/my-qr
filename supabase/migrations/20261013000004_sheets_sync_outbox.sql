-- Migration: Sheets Sync Outbox, Model Tab Mapping & Triggers
-- Up migration: 20261013000004_sheets_sync_outbox.sql
-- Mục đích: Hàng đợi đồng bộ Google Sheets theo chuẩn Transactional Outbox,
--          cơ chế Lease/Claim (SKIP LOCKED) chống tranh chấp worker, và bảng mapping tab model.

-- 1. Bảng hàng đợi outbox
CREATE TABLE IF NOT EXISTS public.sheets_sync_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('CATALOG', 'DEVICE', 'WARRANTY_CASE')),
    entity_id UUID NOT NULL,
    model_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    action TEXT NOT NULL DEFAULT 'UPSERT' CHECK (action IN ('UPSERT', 'DELETE')),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'FATAL_ERROR')),
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index phục vụ polling / claim worker
CREATE INDEX IF NOT EXISTS idx_sheets_outbox_claim 
ON public.sheets_sync_outbox (status, next_retry_at) 
WHERE status IN ('PENDING', 'FAILED', 'PROCESSING');

-- Coalesce: Tối đa 1 job PENDING hoặc PROCESSING cho mỗi entity tại 1 thời điểm
CREATE UNIQUE INDEX IF NOT EXISTS idx_sheets_outbox_unprocessed_unique
ON public.sheets_sync_outbox (entity_type, entity_id)
WHERE status IN ('PENDING', 'PROCESSING');

-- 2. Bảng mapping model_id -> Google Sheets tab (sheetId)
CREATE TABLE IF NOT EXISTS public.sheets_model_mapping (
    model_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
    sheet_id INT NOT NULL,
    tab_title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. RLS Policies
ALTER TABLE public.sheets_sync_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sheets_model_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin access sheets_sync_outbox" ON public.sheets_sync_outbox;
CREATE POLICY "Admin access sheets_sync_outbox" ON public.sheets_sync_outbox
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin access sheets_model_mapping" ON public.sheets_model_mapping;
CREATE POLICY "Admin access sheets_model_mapping" ON public.sheets_model_mapping
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 4. Trigger Outbox cho products (Giai đoạn 1: Tab Danh mục)
CREATE OR REPLACE FUNCTION public.fn_trg_products_sheets_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.sheets_sync_outbox (entity_type, entity_id, action, status, next_retry_at)
    VALUES ('CATALOG', NEW.id, 'UPSERT', 'PENDING', now())
    ON CONFLICT (entity_type, entity_id) WHERE status IN ('PENDING', 'PROCESSING')
    DO UPDATE SET 
        updated_at = now(),
        next_retry_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_sheets_outbox ON public.products;
CREATE TRIGGER trg_products_sheets_outbox
AFTER INSERT OR UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.fn_trg_products_sheets_outbox();

-- 5. RPC Functions: Claim Outbox Jobs (Lease locking)
CREATE OR REPLACE FUNCTION public.rpc_claim_sheets_outbox_jobs(
    p_worker_id TEXT,
    p_batch_size INT DEFAULT 20
)
RETURNS SETOF public.sheets_sync_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH claimable AS (
        SELECT id FROM public.sheets_sync_outbox
        WHERE (
            (status = 'PENDING' AND next_retry_at <= now())
            OR (status = 'FAILED' AND retry_count < max_retries AND next_retry_at <= now())
            OR (status = 'PROCESSING' AND locked_at < now() - INTERVAL '3 minutes')
        )
        ORDER BY created_at ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.sheets_sync_outbox
    SET status = 'PROCESSING',
        locked_at = now(),
        locked_by = p_worker_id,
        updated_at = now()
    FROM claimable
    WHERE public.sheets_sync_outbox.id = claimable.id
    RETURNING public.sheets_sync_outbox.*;
END;
$$;

-- 6. RPC Function: Hoàn tất / Báo lỗi Outbox Job
CREATE OR REPLACE FUNCTION public.rpc_finish_sheets_outbox_job(
    p_job_id UUID,
    p_success BOOLEAN,
    p_is_fatal BOOLEAN DEFAULT FALSE,
    p_error_message TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_retry_count INT;
BEGIN
    IF p_success THEN
        UPDATE public.sheets_sync_outbox
        SET status = 'SUCCESS',
            last_error = NULL,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = now()
        WHERE id = p_job_id;
    ELSIF p_is_fatal THEN
        UPDATE public.sheets_sync_outbox
        SET status = 'FATAL_ERROR',
            last_error = p_error_message,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = now()
        WHERE id = p_job_id;
    ELSE
        SELECT retry_count + 1 INTO v_retry_count FROM public.sheets_sync_outbox WHERE id = p_job_id;
        UPDATE public.sheets_sync_outbox
        SET status = 'FAILED',
            retry_count = v_retry_count,
            last_error = p_error_message,
            next_retry_at = now() + (POWER(2, LEAST(v_retry_count, 6)) * INTERVAL '30 seconds'),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = now()
        WHERE id = p_job_id;
    END IF;
END;
$$;
