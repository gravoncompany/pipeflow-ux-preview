CREATE TABLE public.polp_bank_ai_suggestions (
  company_key text NOT NULL CHECK (company_key ~ '^crm:[0-9]+$'),
  polp_transaction_id text NOT NULL CHECK (length(polp_transaction_id) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('receita_operacional','despesa_operacional','despesa_pessoal','entrada_pessoal','aplicacao','resgate','rendimento','transferencia_interna','emprestimo','nao_classificado')),
  category text CHECK (category IS NULL OR length(category) <= 60),
  confidence text NOT NULL CHECK (confidence IN ('alta','media','baixa')),
  reason text CHECK (reason IS NULL OR length(reason) <= 300),
  model text NOT NULL CHECK (length(model) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_key, polp_transaction_id)
);
GRANT ALL ON public.polp_bank_ai_suggestions TO service_role;
ALTER TABLE public.polp_bank_ai_suggestions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.polp_bank_ai_suggestions IS 'Gravon IA category suggestions for bank transactions; suggestions only, never confirmations. Service-only.';