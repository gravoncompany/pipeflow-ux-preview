-- Fase 1 — Base bancária Polp (somente leitura do banco; nenhum lançamento financeiro é criado).
-- Aditiva: apenas tabelas e funções novas. Não lê nem altera finance_records, crm_client_*, universe_* ou polp_consents.
-- Segurança:
--  * Tabelas service-only: RLS ativo sem políticas; anon/authenticated sem acesso; service_role apenas SELECT.
--  * Escrita exclusivamente por RPCs SECURITY DEFINER restritas à service_role, com lease de sincronização.
--  * Registros bancários nunca são apagados; histórico de versões append-only preserva o original (revisão 1).
--  * Documento da contraparte nunca é armazenado: apenas HMAC (chave do servidor) para conciliação futura.
--  * Isolamento por empresa: company_key obrigatório em todas as linhas, chaves únicas e FKs incluem a empresa.
-- O migrador executa este arquivo em uma única transação.
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.polp_bank_accounts (
 company_key text NOT NULL CHECK (company_key ~ '^crm:[0-9]{1,9}$'),
 polp_account_id text NOT NULL CHECK (length(polp_account_id) BETWEEN 1 AND 128),
 consent_id text NOT NULL CHECK (length(consent_id) BETWEEN 8 AND 128),
 account_type text CHECK (account_type IS NULL OR length(account_type) <= 60),
 account_subtype text CHECK (account_subtype IS NULL OR length(account_subtype) <= 60),
 currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
 number_suffix text CHECK (number_suffix IS NULL OR number_suffix ~ '^[0-9]{1,4}$'),
 first_seen_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (company_key, polp_account_id)
);

CREATE TABLE public.polp_bank_balance_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_key text NOT NULL,
 polp_account_id text NOT NULL,
 bank_updated_at timestamptz NOT NULL,
 available_cents bigint,
 blocked_cents bigint,
 invested_cents bigint,
 currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
 captured_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (company_key, polp_account_id) REFERENCES public.polp_bank_accounts(company_key, polp_account_id),
 UNIQUE (company_key, polp_account_id, bank_updated_at)
);

CREATE TABLE public.polp_bank_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_key text NOT NULL,
 polp_transaction_id text NOT NULL CHECK (length(polp_transaction_id) BETWEEN 1 AND 128),
 polp_account_id text NOT NULL,
 consent_id text NOT NULL CHECK (length(consent_id) BETWEEN 8 AND 128),
 transaction_at timestamptz,
 amount_raw text NOT NULL CHECK (length(amount_raw) BETWEEN 1 AND 40),
 amount_cents bigint,
 currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
 direction text CHECK (direction IS NULL OR direction IN ('CREDITO','DEBITO')),
 transaction_type text CHECK (transaction_type IS NULL OR length(transaction_type) <= 60),
 description text CHECK (description IS NULL OR length(description) <= 300),
 category_ref text CHECK (category_ref IS NULL OR length(category_ref) <= 80),
 counterparty_name text CHECK (counterparty_name IS NULL OR length(counterparty_name) <= 200),
 counterparty_doc_hmac text CHECK (counterparty_doc_hmac IS NULL OR counterparty_doc_hmac ~ '^[0-9a-f]{64}$'),
 counterparty_doc_kind text CHECK (counterparty_doc_kind IS NULL OR counterparty_doc_kind IN ('cpf','cnpj')),
 counterparty_key_version smallint CHECK (counterparty_key_version IS NULL OR counterparty_key_version BETWEEN 1 AND 100),
 counterparty_person_type text CHECK (counterparty_person_type IS NULL OR counterparty_person_type IN ('PESSOA_NATURAL','PESSOA_JURIDICA')),
 provider_created_at timestamptz,
 provider_updated_at timestamptz,
 content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
 revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
 first_seen_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 last_sync_run uuid,
 CHECK ((counterparty_doc_hmac IS NULL) = (counterparty_doc_kind IS NULL) AND (counterparty_doc_hmac IS NULL) = (counterparty_key_version IS NULL)),
 FOREIGN KEY (company_key, polp_account_id) REFERENCES public.polp_bank_accounts(company_key, polp_account_id),
 UNIQUE (company_key, polp_transaction_id)
);
CREATE INDEX polp_bank_transactions_period ON public.polp_bank_transactions(company_key, transaction_at DESC);
CREATE INDEX polp_bank_transactions_counterparty ON public.polp_bank_transactions(company_key, counterparty_doc_hmac) WHERE counterparty_doc_hmac IS NOT NULL;

-- Histórico append-only: revisão 1 é o registro original; cada mudança do provedor gera nova revisão.
CREATE TABLE public.polp_bank_transaction_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_key text NOT NULL,
 transaction_id uuid NOT NULL REFERENCES public.polp_bank_transactions(id),
 revision integer NOT NULL CHECK (revision >= 1),
 content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
 snapshot jsonb NOT NULL,
 sync_run uuid,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (transaction_id, revision)
);

CREATE TABLE public.polp_sync_state (
 company_key text NOT NULL CHECK (company_key ~ '^crm:[0-9]{1,9}$'),
 consent_id text NOT NULL CHECK (length(consent_id) BETWEEN 8 AND 128),
 lease_id uuid,
 lease_until timestamptz,
 last_success_at timestamptz,
 last_success_started_at timestamptz,
 PRIMARY KEY (company_key, consent_id)
);

CREATE TABLE public.polp_sync_runs (
 id uuid PRIMARY KEY,
 company_key text NOT NULL CHECK (company_key ~ '^crm:[0-9]{1,9}$'),
 consent_id text NOT NULL,
 trigger text NOT NULL CHECK (trigger IN ('manual','scheduled')),
 mode text NOT NULL CHECK (mode IN ('incremental','range')),
 window_from timestamptz NOT NULL,
 window_to timestamptz NOT NULL CHECK (window_to >= window_from),
 status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial','failed')),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 accounts_seen integer NOT NULL DEFAULT 0 CHECK (accounts_seen >= 0),
 inserted integer NOT NULL DEFAULT 0 CHECK (inserted >= 0),
 updated integer NOT NULL DEFAULT 0 CHECK (updated >= 0),
 unchanged integer NOT NULL DEFAULT 0 CHECK (unchanged >= 0),
 skipped integer NOT NULL DEFAULT 0 CHECK (skipped >= 0),
 error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{1,40}$')
);
CREATE INDEX polp_sync_runs_recent ON public.polp_sync_runs(company_key, consent_id, started_at DESC);

-- Proteções de integridade: nada é apagado; versões, saldos e identidade dos registros são imutáveis.
-- IFs aninhados por tabela: o PL/pgSQL avalia cada expressão inteira, então campos de outra tabela não podem
-- aparecer na mesma condição.
CREATE OR REPLACE FUNCTION public.polp_bank_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'polp_bank_immutable'; END IF;
 IF TG_TABLE_NAME IN ('polp_bank_transaction_versions','polp_bank_balance_snapshots') THEN RAISE EXCEPTION 'polp_bank_immutable'; END IF;
 IF TG_TABLE_NAME = 'polp_bank_transactions' THEN
  IF NEW.id <> OLD.id OR NEW.company_key <> OLD.company_key OR NEW.polp_transaction_id <> OLD.polp_transaction_id OR NEW.polp_account_id <> OLD.polp_account_id OR NEW.first_seen_at <> OLD.first_seen_at OR NEW.revision < OLD.revision THEN
   RAISE EXCEPTION 'polp_bank_identity_immutable';
  END IF;
 ELSIF TG_TABLE_NAME = 'polp_bank_accounts' THEN
  IF NEW.company_key <> OLD.company_key OR NEW.polp_account_id <> OLD.polp_account_id THEN
   RAISE EXCEPTION 'polp_bank_identity_immutable';
  END IF;
 ELSIF TG_TABLE_NAME = 'polp_sync_runs' THEN
  IF NEW.id <> OLD.id OR NEW.company_key <> OLD.company_key OR NEW.consent_id <> OLD.consent_id OR OLD.status <> 'running' THEN
   RAISE EXCEPTION 'polp_sync_run_immutable';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER polp_bank_accounts_guard BEFORE UPDATE OR DELETE ON public.polp_bank_accounts FOR EACH ROW EXECUTE FUNCTION public.polp_bank_guard();
CREATE TRIGGER polp_bank_balance_snapshots_guard BEFORE UPDATE OR DELETE ON public.polp_bank_balance_snapshots FOR EACH ROW EXECUTE FUNCTION public.polp_bank_guard();
CREATE TRIGGER polp_bank_transactions_guard BEFORE UPDATE OR DELETE ON public.polp_bank_transactions FOR EACH ROW EXECUTE FUNCTION public.polp_bank_guard();
CREATE TRIGGER polp_bank_transaction_versions_guard BEFORE UPDATE OR DELETE ON public.polp_bank_transaction_versions FOR EACH ROW EXECUTE FUNCTION public.polp_bank_guard();
CREATE TRIGGER polp_sync_runs_guard BEFORE UPDATE OR DELETE ON public.polp_sync_runs FOR EACH ROW EXECUTE FUNCTION public.polp_bank_guard();

-- Lease atômico por empresa+consentimento; cria a execução 'running'. Retorna o id da execução ou NULL (ocupado).
CREATE OR REPLACE FUNCTION public.claim_polp_sync(p_company_key text, p_consent_id text, p_trigger text, p_mode text, p_from timestamptz, p_to timestamptz, p_lease_seconds integer DEFAULT 600)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_run uuid := gen_random_uuid(); v_rows integer;
BEGIN
 IF p_company_key IS NULL OR p_company_key !~ '^crm:[0-9]{1,9}$' THEN RAISE EXCEPTION 'invalid company'; END IF;
 IF p_consent_id IS NULL OR length(p_consent_id) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'invalid consent id'; END IF;
 IF p_lease_seconds IS NULL OR p_lease_seconds < 60 OR p_lease_seconds > 900 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > interval '93 days' THEN RAISE EXCEPTION 'invalid window'; END IF;
 INSERT INTO public.polp_sync_state(company_key, consent_id) VALUES (p_company_key, p_consent_id) ON CONFLICT DO NOTHING;
 UPDATE public.polp_sync_state SET lease_id = v_run, lease_until = now() + make_interval(secs => p_lease_seconds)
  WHERE company_key = p_company_key AND consent_id = p_consent_id AND (lease_until IS NULL OR lease_until <= now());
 GET DIAGNOSTICS v_rows = ROW_COUNT;
 IF v_rows <> 1 THEN RETURN NULL; END IF;
 -- Execução anterior interrompida (lease expirado) é encerrada como falha antes da nova.
 UPDATE public.polp_sync_runs SET status = 'failed', finished_at = now(), error_code = 'lease_expired'
  WHERE company_key = p_company_key AND consent_id = p_consent_id AND status = 'running';
 INSERT INTO public.polp_sync_runs(id, company_key, consent_id, trigger, mode, window_from, window_to)
  VALUES (v_run, p_company_key, p_consent_id, p_trigger, p_mode, p_from, p_to);
 RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.polp_sync_assert_lease(p_company_key text, p_consent_id text, p_run uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.polp_sync_state s JOIN public.polp_sync_runs r ON r.id = s.lease_id
  WHERE s.company_key = p_company_key AND s.consent_id = p_consent_id AND s.lease_id = p_run AND s.lease_until > now() AND r.status = 'running'
  FOR UPDATE OF s;
 IF NOT FOUND THEN RAISE EXCEPTION 'polp_sync_lease_lost'; END IF;
END;
$$;

-- Contas e saldos vistos na execução. Saldo é um instantâneo por data informada pelo banco (sem duplicar).
CREATE OR REPLACE FUNCTION public.record_polp_bank_accounts(p_company_key text, p_consent_id text, p_run uuid, p_accounts jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a jsonb; v_count integer := 0;
BEGIN
 PERFORM public.polp_sync_assert_lease(p_company_key, p_consent_id, p_run);
 IF jsonb_typeof(p_accounts) <> 'array' OR jsonb_array_length(p_accounts) > 50 THEN RAISE EXCEPTION 'invalid accounts'; END IF;
 FOR a IN SELECT * FROM jsonb_array_elements(p_accounts) LOOP
  INSERT INTO public.polp_bank_accounts(company_key, polp_account_id, consent_id, account_type, account_subtype, currency, number_suffix)
   VALUES (p_company_key, a->>'polp_account_id', p_consent_id, a->>'account_type', a->>'account_subtype', a->>'currency', a->>'number_suffix')
   ON CONFLICT (company_key, polp_account_id) DO UPDATE SET last_seen_at = now(), account_type = EXCLUDED.account_type,
    account_subtype = EXCLUDED.account_subtype, currency = EXCLUDED.currency, number_suffix = EXCLUDED.number_suffix
   WHERE public.polp_bank_accounts.consent_id = p_consent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'polp_account_consent_mismatch'; END IF;
  IF a->>'bank_updated_at' IS NOT NULL THEN
   INSERT INTO public.polp_bank_balance_snapshots(company_key, polp_account_id, bank_updated_at, available_cents, blocked_cents, invested_cents, currency)
    VALUES (p_company_key, a->>'polp_account_id', (a->>'bank_updated_at')::timestamptz, (a->>'available_cents')::bigint, (a->>'blocked_cents')::bigint, (a->>'invested_cents')::bigint, a->>'balance_currency')
    ON CONFLICT (company_key, polp_account_id, bank_updated_at) DO NOTHING;
  END IF;
  v_count := v_count + 1;
 END LOOP;
 UPDATE public.polp_sync_runs SET accounts_seen = v_count WHERE id = p_run;
 RETURN v_count;
END;
$$;

-- Upsert idempotente: mesmo conteúdo → inalterado; conteúdo novo do provedor → nova revisão + versão;
-- atualização mais antiga que a armazenada é ignorada. Nunca apaga nem cria lançamentos financeiros.
CREATE OR REPLACE FUNCTION public.upsert_polp_bank_transactions(p_company_key text, p_consent_id text, p_run uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb; cur public.polp_bank_transactions; v_id uuid; v_ins integer := 0; v_upd integer := 0; v_same integer := 0; v_updated_at timestamptz;
BEGIN
 PERFORM public.polp_sync_assert_lease(p_company_key, p_consent_id, p_run);
 IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN RAISE EXCEPTION 'invalid rows'; END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  PERFORM 1 FROM public.polp_bank_accounts WHERE company_key = p_company_key AND polp_account_id = r->>'polp_account_id' AND consent_id = p_consent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'polp_account_consent_mismatch'; END IF;
  v_updated_at := (r->>'provider_updated_at')::timestamptz;
  INSERT INTO public.polp_bank_transactions(company_key, polp_transaction_id, polp_account_id, consent_id, transaction_at, amount_raw, amount_cents, currency, direction,
   transaction_type, description, category_ref, counterparty_name, counterparty_doc_hmac, counterparty_doc_kind, counterparty_key_version, counterparty_person_type,
   provider_created_at, provider_updated_at, content_hash, last_sync_run)
  VALUES (p_company_key, r->>'polp_transaction_id', r->>'polp_account_id', p_consent_id, (r->>'transaction_at')::timestamptz, r->>'amount_raw', (r->>'amount_cents')::bigint,
   r->>'currency', r->>'direction', r->>'transaction_type', r->>'description', r->>'category_ref', r->>'counterparty_name', r->>'counterparty_doc_hmac',
   r->>'counterparty_doc_kind', (r->>'counterparty_key_version')::smallint, r->>'counterparty_person_type', (r->>'provider_created_at')::timestamptz, v_updated_at,
   r->>'content_hash', p_run)
  ON CONFLICT (company_key, polp_transaction_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
   INSERT INTO public.polp_bank_transaction_versions(company_key, transaction_id, revision, content_hash, snapshot, sync_run)
    VALUES (p_company_key, v_id, 1, r->>'content_hash', r - 'content_hash', p_run);
   v_ins := v_ins + 1;
  ELSE
   SELECT * INTO cur FROM public.polp_bank_transactions WHERE company_key = p_company_key AND polp_transaction_id = r->>'polp_transaction_id' FOR UPDATE;
   IF cur.polp_account_id <> r->>'polp_account_id' THEN RAISE EXCEPTION 'polp_transaction_account_mismatch'; END IF;
   IF cur.content_hash = r->>'content_hash' OR (cur.provider_updated_at IS NOT NULL AND v_updated_at IS NOT NULL AND v_updated_at < cur.provider_updated_at) THEN
    UPDATE public.polp_bank_transactions SET last_seen_at = now(), last_sync_run = p_run WHERE id = cur.id;
    v_same := v_same + 1;
   ELSE
    UPDATE public.polp_bank_transactions SET transaction_at = (r->>'transaction_at')::timestamptz, amount_raw = r->>'amount_raw', amount_cents = (r->>'amount_cents')::bigint,
     currency = r->>'currency', direction = r->>'direction', transaction_type = r->>'transaction_type', description = r->>'description', category_ref = r->>'category_ref',
     counterparty_name = r->>'counterparty_name', counterparty_doc_hmac = r->>'counterparty_doc_hmac', counterparty_doc_kind = r->>'counterparty_doc_kind',
     counterparty_key_version = (r->>'counterparty_key_version')::smallint, counterparty_person_type = r->>'counterparty_person_type',
     provider_created_at = (r->>'provider_created_at')::timestamptz, provider_updated_at = v_updated_at, content_hash = r->>'content_hash',
     revision = cur.revision + 1, last_seen_at = now(), last_sync_run = p_run
    WHERE id = cur.id;
    INSERT INTO public.polp_bank_transaction_versions(company_key, transaction_id, revision, content_hash, snapshot, sync_run)
     VALUES (p_company_key, cur.id, cur.revision + 1, r->>'content_hash', r - 'content_hash', p_run);
    v_upd := v_upd + 1;
   END IF;
  END IF;
 END LOOP;
 UPDATE public.polp_sync_runs SET inserted = inserted + v_ins, updated = updated + v_upd, unchanged = unchanged + v_same WHERE id = p_run;
 RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'unchanged', v_same);
END;
$$;

-- Encerra a execução e libera o lease. Somente 'success' avança o cursor incremental.
CREATE OR REPLACE FUNCTION public.finish_polp_sync(p_company_key text, p_consent_id text, p_run uuid, p_status text, p_skipped integer, p_error_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_started timestamptz;
BEGIN
 IF p_status NOT IN ('success','partial','failed') THEN RAISE EXCEPTION 'invalid status'; END IF;
 IF p_skipped IS NULL OR p_skipped < 0 THEN RAISE EXCEPTION 'invalid skipped'; END IF;
 UPDATE public.polp_sync_runs SET status = p_status, finished_at = now(), skipped = p_skipped, error_code = p_error_code
  WHERE id = p_run AND company_key = p_company_key AND consent_id = p_consent_id AND status = 'running'
  RETURNING started_at INTO v_started;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.polp_sync_state SET lease_id = NULL, lease_until = NULL,
  last_success_at = CASE WHEN p_status = 'success' THEN now() ELSE last_success_at END,
  last_success_started_at = CASE WHEN p_status = 'success' THEN v_started ELSE last_success_started_at END
  WHERE company_key = p_company_key AND consent_id = p_consent_id AND lease_id = p_run;
 RETURN true;
END;
$$;

-- Permissões: tabelas somente leitura para service_role; nenhum acesso para anon/authenticated.
-- Funções internas (guarda e verificação de lease) não são executáveis por nenhum papel da API; apenas as 4 RPCs.
ALTER TABLE public.polp_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polp_bank_balance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polp_bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polp_bank_transaction_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polp_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polp_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.polp_bank_accounts, public.polp_bank_balance_snapshots, public.polp_bank_transactions, public.polp_bank_transaction_versions, public.polp_sync_state, public.polp_sync_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.polp_bank_accounts, public.polp_bank_balance_snapshots, public.polp_bank_transactions, public.polp_bank_transaction_versions, public.polp_sync_state, public.polp_sync_runs TO service_role;
REVOKE ALL ON FUNCTION public.polp_bank_guard(), public.polp_sync_assert_lease(text,text,uuid),
 public.claim_polp_sync(text,text,text,text,timestamptz,timestamptz,integer), public.record_polp_bank_accounts(text,text,uuid,jsonb),
 public.upsert_polp_bank_transactions(text,text,uuid,jsonb), public.finish_polp_sync(text,text,uuid,text,integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_polp_sync(text,text,text,text,timestamptz,timestamptz,integer), public.record_polp_bank_accounts(text,text,uuid,jsonb),
 public.upsert_polp_bank_transactions(text,text,uuid,jsonb), public.finish_polp_sync(text,text,uuid,text,integer,text) TO service_role;
COMMENT ON TABLE public.polp_bank_transactions IS 'Bank ledger mirror from Polp (read-only source). Never deleted; never creates finance entries. Counterparty documents stored only as server HMAC.';
