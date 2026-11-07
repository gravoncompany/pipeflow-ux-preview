// Versão experimental (pipeflow-ux-preview): sem conexão embutida.
// Esta cópia NÃO aponta para o banco de produção por padrão. Configure o banco desejado
// por variáveis de ambiente (veja .env.example): VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.
// Nunca adicione chaves privadas/de serviço aqui.
export const cloudPublicBinding: Record<string, string | undefined> = {
  VITE_SUPABASE_URL: undefined,
  VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
};
