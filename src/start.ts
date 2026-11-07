import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { previewSessionHeaders } from "./lib/crm-preview-session";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Carries the signed CRM session in the editor preview, where the cross-site iframe
// may drop the HttpOnly cookie. It travels both as a header and inside the request
// payload (the preview proxy may strip custom headers). The server ignores both on
// the published site and still verifies the signature and expiry.
const attachCrmPreviewSession = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const headers = previewSessionHeaders();
    const token = Object.values(headers)[0];
    return next({ headers, sendContext: token ? { crmPreviewSession: token } : {} });
  })
  .server(async ({ next, context }) => {
    const token = (context as { crmPreviewSession?: unknown } | undefined)?.crmPreviewSession;
    if (typeof token === "string") {
      const [{ getRequest }, { rememberPreviewToken }] = await Promise.all([
        import("@tanstack/react-start/server"),
        import("./lib/crm-preview-request.server"),
      ]);
      rememberPreviewToken(getRequest(), token);
    }
    return next();
  });

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, attachCrmPreviewSession],
  requestMiddleware: [errorMiddleware],
}));
