-- SQL Migration for Email Intelligence Engine

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'raw_email_status') THEN
        CREATE TYPE raw_email_status AS ENUM ('pending_ai', 'classified', 'failed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_queue_status') THEN
        CREATE TYPE review_queue_status AS ENUM ('pending', 'approved', 'rejected');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
        CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_priority') THEN
        CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
    END IF;
END$$;

-- raw_emails table
CREATE TABLE IF NOT EXISTS public.raw_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    nylas_message_id TEXT NOT NULL,
    subject TEXT,
    body TEXT,
    sender TEXT,
    recipients JSONB,
    status raw_email_status DEFAULT 'pending_ai',
    received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- email_classifications table
CREATE TABLE IF NOT EXISTS public.email_classifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id UUID REFERENCES public.raw_emails(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    confidence_score NUMERIC(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- extracted_fields table
CREATE TABLE IF NOT EXISTS public.extracted_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id UUID REFERENCES public.raw_emails(id) ON DELETE CASCADE,
    fields JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- review_queue table
CREATE TABLE IF NOT EXISTS public.review_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id UUID REFERENCES public.raw_emails(id) ON DELETE CASCADE,
    classification_id UUID REFERENCES public.email_classifications(id) ON DELETE CASCADE,
    status review_queue_status DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- tasks table
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    related_email_id UUID REFERENCES public.raw_emails(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_date TIMESTAMPTZ,
    status task_status DEFAULT 'pending',
    priority task_priority DEFAULT 'medium',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_raw_emails_user_id ON public.raw_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_raw_emails_status ON public.raw_emails(status);
CREATE INDEX IF NOT EXISTS idx_email_classifications_email_id ON public.email_classifications(email_id);
CREATE INDEX IF NOT EXISTS idx_extracted_fields_email_id ON public.extracted_fields(email_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_email_id ON public.review_queue(email_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON public.review_queue(status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON public.tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_related_email_id ON public.tasks(related_email_id);
