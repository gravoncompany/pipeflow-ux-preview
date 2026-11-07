ALTER TABLE public.leads
 ADD COLUMN utm_source text NOT NULL DEFAULT '',
 ADD COLUMN utm_medium text NOT NULL DEFAULT '',
 ADD COLUMN utm_campaign text NOT NULL DEFAULT '',
 ADD COLUMN utm_content text NOT NULL DEFAULT '',
 ADD COLUMN utm_term text NOT NULL DEFAULT '';
COMMENT ON COLUMN public.leads.utm_source IS 'Original UTM source captured from the submitted form; empty when not provided.';
COMMENT ON COLUMN public.leads.utm_medium IS 'Original UTM medium from the submitted form.';
COMMENT ON COLUMN public.leads.utm_campaign IS 'Original UTM campaign from the submitted form.';
COMMENT ON COLUMN public.leads.utm_content IS 'Original UTM content from the submitted form.';
COMMENT ON COLUMN public.leads.utm_term IS 'Original UTM term from the submitted form.';