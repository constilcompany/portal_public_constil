-- Migration: 20261007230000_secure_blueprint_estimate_idempotency.sql
-- Description: Implement atomic job creation, credit deduction, idempotency table,
-- and transactional refund functions for secure PDF estimation jobs.

-- 1. Create dedicated Idempotency table for blueprint estimation jobs
CREATE TABLE IF NOT EXISTS public.pdf_job_idempotency (
    user_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL,
    job_id UUID NOT NULL REFERENCES public.pdf_jobs(id) ON DELETE CASCADE,
    payload_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_pdf_job_idempotency_job_id ON public.pdf_job_idempotency(job_id);

-- Enable RLS on idempotency table
ALTER TABLE public.pdf_job_idempotency ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'pdf_job_idempotency' AND policyname = 'Users can view own idempotency records'
    ) THEN
        CREATE POLICY "Users can view own idempotency records"
            ON public.pdf_job_idempotency
            FOR SELECT
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;
END$$;

-- 2. Atomic Stored Procedure: start_pdf_estimation_atomic
-- Performs row-level locking (FOR UPDATE) on user wallet, enforces unique idempotency,
-- rejects payload mismatches, and inserts the job + transaction in a single database transaction.
CREATE OR REPLACE FUNCTION public.start_pdf_estimation_atomic(
    p_user_id UUID,
    p_pdf_key TEXT,
    p_filename TEXT,
    p_idempotency_key TEXT,
    p_payload_hash TEXT,
    p_scopes JSONB,
    p_plan_name TEXT,
    p_detail JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing_idemp RECORD;
    v_existing_job RECORD;
    v_action_cost INT := 3;
    v_is_active BOOLEAN := TRUE;
    v_wallet RECORD;
    v_legacy RECORD;
    v_credits_deducted INT := 0;
    v_deducted_from TEXT := 'none';
    v_new_job_id UUID;
    v_remaining INT := 0;
BEGIN
    -- Step 1: Check Idempotency Key
    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        SELECT job_id, payload_hash INTO v_existing_idemp
        FROM public.pdf_job_idempotency
        WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            -- Check if request payload hash matches
            IF v_existing_idemp.payload_hash <> p_payload_hash THEN
                RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: Idempotency key reused with different request payload'
                    USING ERRCODE = 'P0001';
            END IF;

            -- Return existing job without duplicate deduction
            SELECT id, status, message, created_at, filename, pdf_key, detail
            INTO v_existing_job
            FROM public.pdf_jobs
            WHERE id = v_existing_idemp.job_id;

            RETURN jsonb_build_object(
                'status', 'idempotent_replay',
                'job_id', v_existing_job.id,
                'job_status', v_existing_job.status,
                'message', v_existing_job.message,
                'created_at', v_existing_job.created_at,
                'credits_deducted', 0,
                'is_retry', true
            );
        END IF;
    END IF;

    -- Step 2: Fetch and validate AI Estimate cost from configuration
    SELECT credit_cost, is_active INTO v_action_cost, v_is_active
    FROM public.credit_action_config
    WHERE action_type = 'ai_estimate';

    IF FOUND AND v_is_active = FALSE THEN
        RAISE EXCEPTION 'ACTION_DISABLED: AI estimation action is currently disabled by administrator'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_action_cost IS NULL OR v_action_cost <= 0 THEN
        v_action_cost := 3; -- Default fallback cost
    END IF;

    -- Step 3: Atomic credit check & deduction with Row Lock (FOR UPDATE)
    SELECT * INTO v_wallet
    FROM public.user_credit_wallets
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_wallet.ai_estimate_unlimited = TRUE THEN
            v_credits_deducted := 0;
            v_deducted_from := 'unlimited';
            v_remaining := v_wallet.ai_estimate_remaining;
        ELSIF v_wallet.ai_estimate_remaining >= v_action_cost THEN
            UPDATE public.user_credit_wallets
            SET ai_estimate_remaining = ai_estimate_remaining - v_action_cost,
                updated_at = NOW()
            WHERE user_id = p_user_id;
            v_credits_deducted := v_action_cost;
            v_deducted_from := 'wallet';
            v_remaining := v_wallet.ai_estimate_remaining - v_action_cost;
        ELSE
            RAISE EXCEPTION 'INSUFFICIENT_CREDITS: Required %, available %', v_action_cost, v_wallet.ai_estimate_remaining
                USING ERRCODE = 'P0003';
        END IF;
    ELSE
        -- Fallback to legacy user_credits table with Row Lock
        SELECT * INTO v_legacy
        FROM public.user_credits
        WHERE user_id = p_user_id
        FOR UPDATE;

        IF FOUND AND v_legacy.balance >= v_action_cost THEN
            UPDATE public.user_credits
            SET balance = balance - v_action_cost
            WHERE user_id = p_user_id;
            v_credits_deducted := v_action_cost;
            v_deducted_from := 'legacy';
            v_remaining := v_legacy.balance - v_action_cost;
        ELSE
            RAISE EXCEPTION 'INSUFFICIENT_CREDITS: Required %, available %', v_action_cost, COALESCE(v_legacy.balance, 0)
                USING ERRCODE = 'P0003';
        END IF;
    END IF;

    -- Step 4: Insert Job into pdf_jobs
    INSERT INTO public.pdf_jobs (
        userid,
        user_id,
        pdf_key,
        filename,
        status,
        message,
        detail
    ) VALUES (
        p_user_id,
        p_user_id,
        p_pdf_key,
        p_filename,
        'pending',
        'Job submitted and queued for estimation',
        jsonb_build_object(
            'selected_scopes', p_scopes,
            'plan_name', p_plan_name,
            'idempotency_key', p_idempotency_key,
            'payload_hash', p_payload_hash,
            'credits_deducted', v_credits_deducted,
            'deducted_from', v_deducted_from,
            'refunded', false
        ) || p_detail
    )
    RETURNING id INTO v_new_job_id;

    -- Step 5: Record consumption transaction audit
    INSERT INTO public.credit_transactions (
        user_id,
        transaction_type,
        credits_change,
        amount_paid,
        reference_id
    ) VALUES (
        p_user_id,
        'consumption',
        -v_credits_deducted,
        0,
        v_new_job_id::TEXT
    );

    -- Step 6: Store idempotency record
    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        INSERT INTO public.pdf_job_idempotency (
            user_id,
            idempotency_key,
            job_id,
            payload_hash
        ) VALUES (
            p_user_id,
            p_idempotency_key,
            v_new_job_id,
            p_payload_hash
        );
    END IF;

    RETURN jsonb_build_object(
        'status', 'created',
        'job_id', v_new_job_id,
        'job_status', 'pending',
        'credits_deducted', v_credits_deducted,
        'remaining_credits', v_remaining,
        'deducted_from', v_deducted_from,
        'is_retry', false
    );
END;
$$;

-- 3. Atomic Stored Procedure: refund_pdf_estimation_atomic
-- Increments balance atomically (never overwriting with stale balance),
-- and guarantees exactly-once refund execution.
CREATE OR REPLACE FUNCTION public.refund_pdf_estimation_atomic(
    p_user_id UUID,
    p_job_id UUID,
    p_reason TEXT DEFAULT 'AI Estimation worker execution failure'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_job RECORD;
    v_detail JSONB;
    v_credits_deducted INT := 0;
    v_deducted_from TEXT := 'wallet';
    v_already_refunded BOOLEAN := FALSE;
    v_new_remaining INT := 0;
BEGIN
    -- Step 1: Lock and verify job record ownership
    SELECT * INTO v_job
    FROM public.pdf_jobs
    WHERE id = p_job_id AND (userid = p_user_id OR user_id = p_user_id)
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'JOB_NOT_FOUND: Job not found or access denied'
            USING ERRCODE = 'P0004';
    END IF;

    v_detail := COALESCE(v_job.detail::jsonb, '{}'::jsonb);
    v_already_refunded := COALESCE((v_detail->>'refunded')::boolean, FALSE);

    -- Step 2: Exactly-once check
    IF v_already_refunded = TRUE THEN
        RETURN jsonb_build_object(
            'status', 'already_refunded',
            'job_id', p_job_id,
            'refunded', false,
            'message', 'Job has already been refunded.'
        );
    END IF;

    v_credits_deducted := COALESCE((v_detail->>'credits_deducted')::int, 0);
    v_deducted_from := COALESCE(v_detail->>'deducted_from', 'wallet');

    -- Step 3: Increment balance atomically (no stale overwrite)
    IF v_credits_deducted > 0 THEN
        IF v_deducted_from = 'legacy' THEN
            UPDATE public.user_credits
            SET balance = balance + v_credits_deducted
            WHERE user_id = p_user_id
            RETURNING balance INTO v_new_remaining;
        ELSE
            UPDATE public.user_credit_wallets
            SET ai_estimate_remaining = ai_estimate_remaining + v_credits_deducted,
                updated_at = NOW()
            WHERE user_id = p_user_id
            RETURNING ai_estimate_remaining INTO v_new_remaining;
        END IF;

        -- Record audit transaction for refund
        INSERT INTO public.credit_transactions (
            user_id,
            transaction_type,
            credits_change,
            amount_paid,
            reference_id
        ) VALUES (
            p_user_id,
            'refund',
            v_credits_deducted,
            0,
            p_job_id::TEXT
        );
    END IF;

    -- Step 4: Update job status to fail and mark as refunded
    UPDATE public.pdf_jobs
    SET status = 'fail',
        message = p_reason,
        detail = v_detail || jsonb_build_object(
            'refunded', true,
            'refunded_at', NOW(),
            'refund_reason', p_reason
        )
    WHERE id = p_job_id;

    RETURN jsonb_build_object(
        'status', 'refunded',
        'job_id', p_job_id,
        'refunded', true,
        'credits_refunded', v_credits_deducted,
        'new_remaining', v_new_remaining
    );
END;
$$;
