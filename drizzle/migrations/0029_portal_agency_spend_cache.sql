CREATE TABLE public.portal_ads_snapshots (
 company_key text NOT NULL DEFAULT 'crm:1' CHECK (company_key = 'crm:1'),
 from_date date NOT NULL, to_date date NOT NULL,
 payload jsonb, succeeded_at timestamptz, attempted_at timestamptz,
 error_code text, lease_id uuid, lease_until timestamptz,
 PRIMARY KEY(company_key,from_date,to_date), CHECK(to_date >= from_date)
);
GRANT ALL ON public.portal_ads_snapshots TO service_role;
REVOKE ALL ON public.portal_ads_snapshots FROM anon, authenticated;
ALTER TABLE public.portal_ads_snapshots ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.portal_ads_campaign_links (
 company_key text NOT NULL DEFAULT 'crm:1' CHECK (company_key = 'crm:1'),
 platform text NOT NULL CHECK(platform IN ('meta_ads','google_ads')), account_id text NOT NULL, campaign_id text NOT NULL,
 pipeline_key text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_key,platform,account_id,campaign_id)
);
GRANT ALL ON public.portal_ads_campaign_links TO service_role;
REVOKE ALL ON public.portal_ads_campaign_links FROM anon, authenticated;
ALTER TABLE public.portal_ads_campaign_links ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.claim_portal_ads_sync(p_from date,p_to date,p_lease uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.portal_ads_snapshots(from_date,to_date) VALUES(p_from,p_to) ON CONFLICT DO NOTHING;
 UPDATE public.portal_ads_snapshots SET lease_id=p_lease,lease_until=now()+interval '5 minutes',attempted_at=now() WHERE company_key='crm:1' AND from_date=p_from AND to_date=p_to AND (lease_until IS NULL OR lease_until<now());
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_portal_ads_sync(date,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_portal_ads_sync(date,date,uuid) TO service_role;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE TABLE public.portal_ads_scheduler (id boolean PRIMARY KEY DEFAULT true CHECK(id), credential text NOT NULL);
GRANT ALL ON public.portal_ads_scheduler TO service_role;
REVOKE ALL ON public.portal_ads_scheduler FROM anon,authenticated;
ALTER TABLE public.portal_ads_scheduler ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.configure_portal_ads_schedule(p_credential text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF length(p_credential)<32 THEN RAISE EXCEPTION 'invalid credential'; END IF;
 INSERT INTO public.portal_ads_scheduler(id,credential) VALUES(true,p_credential) ON CONFLICT(id) DO UPDATE SET credential=excluded.credential;
 PERFORM cron.schedule('crm-portal-ads-daily','15 9 * * *', 'SELECT net.http_post(url:=''https://project--35f32e53-6c82-48bf-beea-4b5125aef274.lovable.app/api/public/jobs/portal-ads-sync'',headers:=jsonb_build_object(''Content-Type'',''application/json'',''Authorization'',''Bearer ''||credential),body:=''{}''::jsonb,timeout_milliseconds:=120000) FROM public.portal_ads_scheduler WHERE id=true');
END $$;
REVOKE ALL ON FUNCTION public.configure_portal_ads_schedule(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_portal_ads_schedule(text) TO service_role;