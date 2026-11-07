ALTER TABLE public.commercial_goals ADD COLUMN pipeline_key text NOT NULL DEFAULT 'main';
ALTER TABLE public.commercial_goals DROP CONSTRAINT commercial_goals_company_key_month_key;
ALTER TABLE public.commercial_goals ADD CONSTRAINT commercial_goals_company_month_pipeline_key UNIQUE (company_key, month, pipeline_key);