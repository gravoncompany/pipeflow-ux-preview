ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS closed_value numeric(14,2);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS closed_value_confirmed_at timestamptz;
ALTER TABLE public.leads ADD CONSTRAINT leads_closed_value_range CHECK (closed_value IS NULL OR (closed_value >= 0 AND closed_value <= 1000000000));
COMMENT ON COLUMN public.leads.closed_value IS 'Valor fechado confirmado (negociação), separado do valor potencial e do recebimento no Financeiro.';

CREATE OR REPLACE FUNCTION public.confirm_lead_closed_value(p_actor text, p_lead uuid, p_value numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.leads%ROWTYPE; entry jsonb; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_value IS NULL OR p_value < 0 OR p_value > 1000000000 THEN RAISE EXCEPTION 'invalid_value'; END IF;
  SELECT * INTO l FROM public.leads WHERE id=p_lead FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_unavailable'; END IF;
  IF l.stage <> 'fechado' THEN RAISE EXCEPTION 'not_closed'; END IF;
  entry := jsonb_build_object('id','closed-value:'||gen_random_uuid(),'date',now(),
    'text', CASE WHEN l.closed_value IS NULL THEN 'Valor fechado confirmado: R$ ' ELSE 'Valor fechado corrigido: R$ ' END || to_char(round(p_value,2),'FM999G999G999G990D00'),
    'kind','closed_value','source','pipeline','responsible',left(p_actor,160));
  UPDATE public.leads SET closed_value=round(p_value,2), closed_value_confirmed_at=now(),
    history=coalesce(history,'[]'::jsonb)||entry WHERE id=p_lead;
  RETURN jsonb_build_object('closedValue', round(p_value,2), 'confirmedAt', now());
END $$;
REVOKE ALL ON FUNCTION public.confirm_lead_closed_value(text,uuid,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_lead_closed_value(text,uuid,numeric) TO service_role;