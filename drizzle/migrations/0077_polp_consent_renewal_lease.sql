-- Polp: lease atômico para renovação do link de autorização (POST /consents/{id}/recreate).
-- Aditiva: apenas duas colunas anuláveis sem default (sem reescrita da tabela) e duas funções service-only.
-- Não altera nem lê dados existentes; consentimentos e dados financeiros são preservados.
-- O migrador executa este arquivo em uma única transação: REVOKE/GRANT entram junto com a criação das funções.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.polp_consents
 ADD COLUMN IF NOT EXISTS renewal_lease_id uuid,
 ADD COLUMN IF NOT EXISTS renewal_lease_until timestamptz;

-- Claim atômico: um único UPDATE condicional. Concorrentes na mesma linha são serializados pelo Postgres e o segundo
-- reavalia o WHERE após o commit do primeiro, sem obter linha. Retorna o id do lease ou NULL (ocupado/inexistente).
-- consent_id é comparado como texto para funcionar tanto com coluna text quanto uuid.
CREATE OR REPLACE FUNCTION public.claim_polp_consent_renewal(p_consent_id text, p_lease_seconds integer DEFAULT 90)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_lease uuid := gen_random_uuid();
 v_rows integer;
BEGIN
 IF p_consent_id IS NULL OR length(p_consent_id) NOT BETWEEN 8 AND 128 THEN
  RAISE EXCEPTION 'invalid consent id';
 END IF;
 IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
  RAISE EXCEPTION 'invalid lease duration';
 END IF;
 UPDATE public.polp_consents
    SET renewal_lease_id = v_lease,
        renewal_lease_until = now() + make_interval(secs => p_lease_seconds)
  WHERE consent_id::text = p_consent_id
    AND (renewal_lease_until IS NULL OR renewal_lease_until <= now());
 GET DIAGNOSTICS v_rows = ROW_COUNT;
 RETURN CASE WHEN v_rows = 1 THEN v_lease ELSE NULL END;
END;
$$;

-- Liberação somente pelo dono do lease. Em resultado desconhecido (timeout) a aplicação não libera:
-- o lease expira sozinho e impede renovação duplicada imediata.
CREATE OR REPLACE FUNCTION public.release_polp_consent_renewal(p_consent_id text, p_lease_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.polp_consents
    SET renewal_lease_id = NULL,
        renewal_lease_until = NULL
  WHERE consent_id::text = p_consent_id
    AND renewal_lease_id = p_lease_id;
 RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_polp_consent_renewal(text,integer),public.release_polp_consent_renewal(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_polp_consent_renewal(text,integer),public.release_polp_consent_renewal(text,uuid) TO service_role;
COMMENT ON FUNCTION public.claim_polp_consent_renewal(text,integer) IS 'Service-only renewal lease for Polp consent link recreation. Never authorizes Polp calls by itself.';
