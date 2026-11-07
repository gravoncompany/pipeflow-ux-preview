-- Perfil exibido no cabeçalho do Pipeflow (foto, nome e e-mail). Aditiva: uma tabela singleton por empresa.
-- Segurança: RLS sem políticas; anon/authenticated sem acesso; somente o servidor (sessão CRM completa) lê e grava.
-- A foto é armazenada como data URL validada (JPEG/PNG/WebP, reduzida para 256 px no navegador, até ~400 KB).
SET LOCAL lock_timeout = '5s';
CREATE TABLE public.crm_profile (
 company_key text PRIMARY KEY CHECK (company_key = 'crm:1'),
 display_name text NOT NULL DEFAULT '' CHECK (length(display_name) <= 80),
 email text NOT NULL DEFAULT '' CHECK (length(email) <= 254),
 photo text CHECK (photo IS NULL OR (length(photo) <= 400000 AND photo ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$')),
 revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_profile ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_profile FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_profile TO service_role;
