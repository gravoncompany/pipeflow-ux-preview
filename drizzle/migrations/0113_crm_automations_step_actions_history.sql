-- Automações: "Atualizar card" logo depois de um e-mail (aplicado quando a Brevo aceita aquele e-mail, sem
-- interromper a cadência) e histórico de envios, falhas e bloqueios por card. Nenhum envio ocorre por esta migração.
ALTER TABLE public.crm_automation_events DROP CONSTRAINT IF EXISTS crm_automation_events_kind_check;
ALTER TABLE public.crm_automation_events ADD CONSTRAINT crm_automation_events_kind_check CHECK (kind IN (
 'enrolled','skipped','reply','opt_out','form','click','card_updated','paused','resumed','cancelled','finished','send_now',
 'sent','send_failed','send_unknown','blocked'));

-- Resultado de cada e-mail da sequência de uma automação. Nunca impede o registro do envio.
CREATE FUNCTION public.crm_automation_on_flow_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.crm_automation_runs; a public.crm_automations; x jsonb; n int;
BEGIN
 IF NEW.direction <> 'out' OR NEW.kind <> 'sequence' OR OLD.state <> 'reserved' OR NEW.state NOT IN ('accepted','failed','unknown') THEN RETURN NULL; END IF;
 BEGIN
  SELECT * INTO r FROM crm_automation_runs WHERE enrollment_id = NEW.enrollment_id;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO a FROM crm_automations WHERE id = r.automation_id;
  n := coalesce(NEW.step, 0) + 1;
  IF NEW.state = 'accepted' THEN
   INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind, detail)
    VALUES (a.id, r.id, r.lead_id, 'sent', n || 'º e-mail aceito pela Brevo' || CASE WHEN NEW.ai_personalized THEN ' (personalizado pela Gravon IA)' ELSE '' END);
   IF r.reply_at IS NULL AND r.form_at IS NULL AND r.cancelled_at IS NULL THEN
    FOR x IN SELECT v FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.compiled->'stepActions') = 'array' THEN a.compiled->'stepActions' ELSE '[]'::jsonb END) v
     WHERE (v->>'step') ~ '^[0-9]+$' AND (v->>'step')::int = NEW.step LOOP
     PERFORM crm_automation_apply_actions(r.lead_id, a.trigger_pipeline_id, x->'actions', 'Automação "' || a.name || '" · após o ' || n || 'º e-mail', r.id, a.id);
    END LOOP;
   END IF;
  ELSE
   INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind, detail)
    VALUES (a.id, r.id, r.lead_id, CASE NEW.state WHEN 'failed' THEN 'send_failed' ELSE 'send_unknown' END,
     left(CASE NEW.state WHEN 'failed' THEN n || 'º e-mail recusado pela Brevo' || coalesce(' (' || nullif(NEW.error_code,'') || ')', '') || '; card pausado na automação'
      ELSE n || 'º e-mail com resultado desconhecido; não foi reenviado' END, 300));
   PERFORM crm_automation_append_history(r.lead_id, 'automation-send:' || NEW.id,
    'Automação "' || a.name || '": ' || CASE NEW.state WHEN 'failed' THEN 'o ' || n || 'º e-mail foi recusado pela Brevo' || coalesce(' (' || nullif(NEW.error_code,'') || ')', '') || '. Envios pausados neste card.'
     ELSE 'o resultado do ' || n || 'º e-mail é desconhecido; por segurança ele não foi reenviado e os envios foram pausados neste card.' END);
  END IF;
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'crm_automation_on_flow_message: %', SQLSTATE;
 END;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_on_flow_message() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_automation_on_flow_message AFTER UPDATE OF state ON public.crm_email_flow_messages
 FOR EACH ROW EXECUTE FUNCTION public.crm_automation_on_flow_message();

-- Bloqueios do envio (e-mail do card mudou, descadastro, mensagem a revisar etc.) ficam no histórico do card.
-- Pausas manuais, cancelamentos, respostas, formulários e falhas de envio já têm registro próprio.
CREATE FUNCTION public.crm_automation_on_enrollment_block() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.crm_automation_runs; a public.crm_automations; why text := coalesce(NEW.reason, '');
BEGIN
 IF OLD.status <> 'active' OR NEW.status NOT IN ('paused','stopped') OR NEW.replied_at IS NOT NULL THEN RETURN NULL; END IF;
 IF why IN ('Pausada manualmente na automação','Automação cancelada manualmente no card','Preencheu o formulário de diagnóstico','Pediu para não receber novos contatos')
  OR why LIKE 'Diagnóstico recebido%' OR why LIKE 'Envio recusado%' OR why LIKE 'Resultado do envio%'
  OR why LIKE 'Mensagem recebida do contato%' OR why LIKE 'Respondeu%' THEN RETURN NULL; END IF;
 BEGIN
  SELECT * INTO r FROM crm_automation_runs WHERE enrollment_id = NEW.id;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO a FROM crm_automations WHERE id = r.automation_id;
  INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind, detail)
   VALUES (a.id, r.id, r.lead_id, 'blocked', left(coalesce(nullif(why,''), 'Envio interrompido'), 300));
  PERFORM crm_automation_append_history(r.lead_id, 'automation-block:' || r.id || ':' || md5(why || clock_timestamp()::text),
   'Automação "' || a.name || '": envios ' || CASE NEW.status WHEN 'stopped' THEN 'encerrados' ELSE 'pausados' END || ' — ' || coalesce(nullif(why,''), 'motivo não informado') || '.');
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'crm_automation_on_enrollment_block: %', SQLSTATE;
 END;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_on_enrollment_block() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_automation_on_enrollment_block AFTER UPDATE OF status ON public.crm_email_flow_enrollments
 FOR EACH ROW EXECUTE FUNCTION public.crm_automation_on_enrollment_block();