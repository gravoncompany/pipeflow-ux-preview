import { getRequest, setResponseHeader } from '@tanstack/react-start/server';
import { mayAccessProjects } from './crm-projects';
export async function projectAccess() {
 const req=getRequest();
 if(req.headers.get('origin')!==new URL(req.url).origin) throw new Error('Origem não autorizada.');
 setResponseHeader('Cache-Control','no-store');
 const {requireCrmLeadSession}=await import('./crm-leads.server');
 const full=(await requireCrmLeadSession(process.env.CRM_SESSION_SECRET))==='full';
 if(!full) throw new Error('Entre com acesso completo e sua conta administrativa.');
 const {internalKnowledgeActor}=await import('./commercial-knowledge.server');
 const actor=await internalKnowledgeActor('projects','menu');
 if(!mayAccessProjects(full,Boolean(actor),actor?.company??null)||!actor) throw new Error('Projetos é exclusivo da administração autorizada da Gravon Company.');
 await actor.authorize();
 const {supabaseAdmin:db}=await import('@/integrations/supabase/client.server');
 return {db,actor};
}
