CREATE TABLE public.ai_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('qualification_pattern','objection','service_failure','winning_practice','sales_frequency')),
  text text NOT NULL,
  sources integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ai_knowledge TO service_role;
ALTER TABLE public.ai_knowledge ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.gravon_ai_test_settings
  ADD COLUMN crm_knowledge_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN crm_knowledge_read_revision text NOT NULL DEFAULT '';