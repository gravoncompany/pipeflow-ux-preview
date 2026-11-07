-- Reforço das tabelas da pesquisa Instagram (0143): igual às demais tabelas B2B, nem o dono da tabela contorna as políticas.
ALTER TABLE public.b2b_instagram_searches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_instagram_profiles FORCE ROW LEVEL SECURITY;