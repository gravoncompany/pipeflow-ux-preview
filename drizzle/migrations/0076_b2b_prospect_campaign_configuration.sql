ALTER TABLE public.b2b_ai_email_batches ADD COLUMN bases jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE public.b2b_prospect_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 config jsonb NOT NULL,
 status text NOT NULL DEFAULT 'configured' CHECK(status IN ('configured','paused','ended')),
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.b2b_prospect_campaigns TO service_role;
REVOKE ALL ON public.b2b_prospect_campaigns FROM anon,authenticated;
ALTER TABLE public.b2b_prospect_campaigns ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.b2b_ai_email_templates (
 key text PRIMARY KEY CHECK(key IN ('odontologia','estetica')),
 subject text NOT NULL,
 body text NOT NULL,
 revision integer NOT NULL DEFAULT 1
);
GRANT ALL ON public.b2b_ai_email_templates TO service_role;
REVOKE ALL ON public.b2b_ai_email_templates FROM anon,authenticated;
ALTER TABLE public.b2b_ai_email_templates ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.b2b_prospect_campaigns IS 'Configuration only. No active state, scheduler, paid research or sending executor.';