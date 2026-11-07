import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { receiptConfig } from "./receipt-control";
export const getReceiptControl=createServerFn({method:"POST"}).handler(async()=>{const {readReceiptControl}=await import("./receipt-control.server");return readReceiptControl(process.env.LOVABLE_API_KEY, process.env.GOOGLE_SHEETS_API_KEY);});
export const saveReceiptSchedule=createServerFn({method:"POST"}).inputValidator(i=>z.object({id:z.string().uuid().nullable(),revision:z.number().int().nonnegative(),operation:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid().nullable(),config:receiptConfig,generate:z.boolean(),confirmed:z.literal(true)}).strict().parse(i)).handler(async({data})=>{
 const {financeAccess}=await import("./finance-management.server");const {db,actor}=await financeAccess(false);
 const {data:id,error}=await (db as unknown as import("@supabase/supabase-js").SupabaseClient).rpc("save_crm_receipt_schedule",{p_actor:actor,p_operation:data.operation,p_id:data.id,p_revision:data.revision,p_client:data.clientId,p_project:data.projectId,p_config:data.config,p_generate:data.generate});
 if(error)throw new Error(error.message.includes("schedule_exists")?"Já existe configuração com este cliente, projeto e descrição. Edite a existente.":error.message.includes("save_before_generate")?"Salve os ajustes antes de gerar novas cobranças.":"Não foi possível salvar. Confira a configuração e atualize antes de repetir.");return {id};
});
export const correctReceiptPayment=createServerFn({method:"POST"}).inputValidator(i=>z.object({operation:z.string().uuid(),paymentId:z.string().uuid(),expectedCharge:z.string().uuid(),targetCharge:z.string().uuid(),reason:z.string().trim().min(5).max(2000),confirmed:z.literal(true)}).strict().parse(i)).handler(async({data})=>{
 const {financeAccess}=await import("./finance-management.server");const {db,actor}=await financeAccess(false);
 const {error}=await db.rpc("correct_crm_receipt_payment",{p_actor:actor,p_operation:data.operation,p_payment:data.paymentId,p_expected_charge:data.expectedCharge,p_target:data.targetCharge,p_reason:data.reason});
 if(error)throw new Error(error.message.includes("hypercash_link_protected")?"Recebimentos HyperCash mantêm o vínculo protegido.":error.message.includes("different_client")?"A correção deve permanecer no mesmo cliente.":"Não foi possível corrigir: confira o saldo da cobrança e atualize o pagamento.");return {ok:true};
});