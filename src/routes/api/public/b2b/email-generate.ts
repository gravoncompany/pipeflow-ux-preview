import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { runEmailBatch } from "@/lib/b2b-email-ai.server";
export const Route = createFileRoute("/api/public/b2b/email-generate")({
  server:{handlers:{POST:async ({request}) => {
    // Public URL is not public authorization: full signed CRM session is checked by handler.
    const raw = await request.text();
    if(raw.length>1000) return Response.json({message:"Pedido inválido."},{status:400});
    let parsed;
    try { parsed=z.object({id:z.string().uuid()}).strict().parse(JSON.parse(raw)); }
    catch { return Response.json({message:"Pedido inválido."},{status:400}); }
    return runEmailBatch(request,parsed.id);
  }}},
});