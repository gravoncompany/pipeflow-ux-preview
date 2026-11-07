import { z } from "zod";

export const INSTAGRAM_OAUTH_CALLBACK =
  "https://crm.gravoncompany.com/api/public/instagram/oauth/callback";
export const INSTAGRAM_OAUTH_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
] as const;
export const instagramOAuthStartInput = z
  .object({ appId: z.string().regex(/^\d{1,40}$/) })
  .strict();
export function instagramAuthorizationUrl(appId: string, state: string) {
  instagramOAuthStartInput.parse({ appId });
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: INSTAGRAM_OAUTH_CALLBACK,
    response_type: "code",
    scope: INSTAGRAM_OAUTH_SCOPES.join(","),
    state,
  }).toString();
  return url.toString();
}
export const instagramOAuthQuery = z.object({
  state: z.string().regex(/^[a-f0-9]{64}$/),
  code: z.string().min(1).max(2048).optional(),
  error: z.string().max(100).optional(),
});
