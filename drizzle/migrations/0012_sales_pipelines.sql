CREATE TABLE public.sales_pipelines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
 stages jsonb NOT NULL CHECK (jsonb_typeof(stages) = 'array' AND jsonb_array_length(stages) > 0),
 archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.sales_pipelines TO service_role;
ALTER TABLE public.sales_pipelines ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX sales_pipelines_active_name ON public.sales_pipelines (lower(btrim(name))) WHERE archived = false;
ALTER TABLE public.leads ADD COLUMN pipeline_id uuid DEFAULT NULL REFERENCES public.sales_pipelines(id);
CREATE INDEX leads_pipeline_id_idx ON public.leads(pipeline_id);
COMMENT ON COLUMN public.leads.pipeline_id IS 'NULL is the original pipeline, including legacy Zapier/capture inserts. Non-null assigns the lead to an additional sales pipeline.';