CREATE TABLE public.crm_whatsapp_group_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_whatsapp_group_tags_name ON public.crm_whatsapp_group_tags (lower(btrim(name)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_whatsapp_group_tags TO service_role;
ALTER TABLE public.crm_whatsapp_group_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_whatsapp_group_tags FROM anon, authenticated;

CREATE TABLE public.crm_whatsapp_group_tag_links (
  instance text NOT NULL CHECK (length(instance) BETWEEN 1 AND 200),
  group_jid text NOT NULL CHECK (group_jid ~ '^[0-9]{5,40}(-[0-9]+)?@g\.us$'),
  tag_id uuid NOT NULL REFERENCES public.crm_whatsapp_group_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance, group_jid, tag_id)
);
CREATE INDEX crm_whatsapp_group_tag_links_tag ON public.crm_whatsapp_group_tag_links(tag_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_whatsapp_group_tag_links TO service_role;
ALTER TABLE public.crm_whatsapp_group_tag_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_whatsapp_group_tag_links FROM anon, authenticated;