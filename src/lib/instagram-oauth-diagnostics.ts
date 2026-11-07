export type InstagramOAuthStage =
  | "configuration"
  | "authorization"
  | "code_exchange"
  | "long_token_exchange"
  | "identity"
  | "permissions"
  | "encryption"
  | "storage";
export type InstagramOAuthCode =
  | "configuration_missing"
  | "authorization_denied"
  | "authorization_code_missing"
  | "admin_required"
  | "provider_rejected"
  | "invalid_client"
  | "invalid_authorization_code"
  | "redirect_uri_mismatch"
  | "transport_failed"
  | "response_invalid"
  | "permissions_missing"
  | "identity_mismatch"
  | "storage_failed";
export class InstagramOAuthError extends Error {
  constructor(
    public stage: InstagramOAuthStage,
    public reason: InstagramOAuthCode,
    public httpStatus: number | null = null,
  ) {
    super(`instagram_oauth_${reason}`);
  }
}
export function instagramOAuthDiagnostic(
  error: unknown,
  fallback: InstagramOAuthStage = "storage",
) {
  return error instanceof InstagramOAuthError
    ? { stage: error.stage, code: error.reason, httpStatus: error.httpStatus }
    : { stage: fallback, code: "storage_failed" as const, httpStatus: null };
}
export function instagramOAuthFailureText(stage: string | null, code: string | null) {
  if (code === "configuration_missing")
    return "Configure a chave secreta específica do Instagram Login nos segredos do CRM.";
  if (code === "invalid_client")
    return "A Meta recusou as credenciais do aplicativo Instagram. Confira o ID e a chave secreta do mesmo aplicativo.";
  if (code === "redirect_uri_mismatch")
    return "A Meta recusou a URL de redirecionamento. Cadastre a URL OAuth exata mostrada abaixo.";
  if (code === "invalid_authorization_code")
    return "A Meta recusou o código de autorização; ele pode ter expirado ou já ter sido utilizado.";
  if (code === "permissions_missing")
    return "A autorização não concedeu as duas permissões obrigatórias do Instagram.";
  if (code === "identity_mismatch")
    return "A identidade confirmada pela Meta não corresponde à conta autorizada. A conexão existente foi preservada.";
  if (code === "authorization_denied") return "A autorização foi cancelada no Instagram.";
  if (code === "authorization_code_missing")
    return "O retorno do Instagram não trouxe um código de autorização.";
  if (stage === "code_exchange" && code === "response_invalid")
    return "A resposta da Meta não pôde ser validada pelo CRM. A conexão existente foi preservada.";
  if (stage === "storage" || stage === "encryption")
    return "Não foi possível armazenar a autorização com segurança. A conexão existente foi preservada.";
  if (stage === "code_exchange")
    return "Falha na troca do código pelo token na Meta. A conexão existente foi preservada.";
  if (stage === "identity") return "A resposta de identificação da Meta não pôde ser validada.";
  if (stage === "permissions")
    return "Não foi possível confirmar as permissões concedidas pela Meta.";
  if (stage === "long_token_exchange")
    return "A Meta não confirmou a troca pelo token de longa duração.";
  return "A tentativa anterior não registrou a etapa exata da falha. A conexão existente foi preservada.";
}
