import { tool } from "ai";
import { proposeMoveInput, validateMoveInput, moveReply, type MoveGrant } from "./gravon-crm-actions";

export function createMoveTools(deps: { authorize: () => Promise<void>; propose: (input: ReturnType<typeof validateMoveInput>) => Promise<unknown> }) {
  let invoked = false;
  let reply: string | null = null;
  let failed = false;
  return {
    tools: {
      proposeLeadStageMove: tool({
        description: "Propõe mover UM lead identificado por busca EXATA para uma etapa padrão. Não executa a mudança. Homônimos exigem identificação pelo usuário; nunca escolha sozinho. A confirmação posterior é exclusiva do sistema.",
        inputSchema: proposeMoveInput,
        execute: async (raw) => {
          try {
            if (invoked) throw new Error("Uma proposta por mensagem.");
            invoked = true;
            const input = validateMoveInput(raw);
            await deps.authorize();
            const result = await deps.propose(input);
            reply = moveReply(result);
            return { reply, changed: false };
          } catch { failed = true; throw new Error("Proposta indisponível; nenhuma mudança autorizada."); }
        },
      }),
    },
    finalReply: () => { if (failed) throw new Error("Proposta indisponível."); return reply; },
  };
}

export async function createDatabaseMoveTools(grant: MoveGrant, authorize: () => Promise<void>) {
  await authorize();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return createMoveTools({ authorize, propose: async (input) => {
    const { data, error } = await supabaseAdmin.rpc("gravon_propose_stage_move", {
      p_instance: grant.instance, p_phone: grant.phone, p_read_revision: grant.readRevision, p_move_revision: grant.revision,
      p_inbound_id: grant.inboundId, p_field: input.field, p_query: input.query, p_target_stage: input.targetStage,
    });
    if (error) throw new Error("Proposta indisponível.");
    return data;
  } });
}

export async function resolveDatabaseMove(grant: MoveGrant, command: { code: string; cancel: boolean }, authorize: () => Promise<void>) {
  await authorize();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("gravon_resolve_stage_move", {
    p_instance: grant.instance, p_phone: grant.phone, p_read_revision: grant.readRevision, p_move_revision: grant.revision,
    p_inbound_id: grant.inboundId, p_code: command.code, p_cancel: command.cancel,
  });
  if (error) throw new Error("Confirmação indisponível.");
  return moveReply(data);
}