import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { projectInput, historyInput, projectFromRow } from './crm-projects';
export const projectsAllowed=createServerFn({method:'POST'}).handler(async()=>{
 try {const {projectAccess}=await import('./crm-projects.server'); await projectAccess();return {allowed:true};}catch{return {allowed:false};}
});
export const listProjects=createServerFn({method:'POST'}).handler(async()=>{
 const {projectAccess}=await import('./crm-projects.server');const {db,actor}=await projectAccess();
 const {data,error}=await db.from('crm_projects').select('*').eq('company_key',actor.company).order('updated_at',{ascending:false}).limit(501);
 if(error)throw new Error('Não foi possível carregar os projetos.'); if((data?.length??0)>500)throw new Error('Limite de projetos excedido.');
 await projectAccess();return {projects:(data??[]).map(projectFromRow)};
});
export const getProjectHistory=createServerFn({method:'POST'}).inputValidator(i=>z.object({id:z.string().uuid(),offset:z.number().int().min(0).max(10000)}).strict().parse(i)).handler(async({data})=>{
 const {projectAccess}=await import('./crm-projects.server');const {db,actor}=await projectAccess();
 const {data:rows,error}=await db.from('crm_project_history').select('id,kind,content,snapshot,created_at,actor').eq('company_key',actor.company).eq('project_id',data.id).order('created_at',{ascending:false}).order('id').range(data.offset,data.offset+50);
 if(error)throw new Error('Não foi possível carregar o histórico.'); await projectAccess();return {records:(rows??[]).slice(0,50),hasMore:(rows?.length??0)>50};
});
function fail(m:string){if(m.includes('project_changed'))throw new Error('O projeto foi alterado. Atualize antes de salvar.');if(m.includes('evidence_required'))throw new Error('Registre os resultados dos testes antes de concluir.');throw new Error('Não foi possível salvar; atualize e confira seu acesso.');}
export const saveProject=createServerFn({method:'POST'}).inputValidator(i=>projectInput.parse(i)).handler(async({data})=>{
 const {projectAccess}=await import('./crm-projects.server');const {db,actor}=await projectAccess();
 const {data:result,error}=await db.rpc('save_crm_project',{p_author:actor.userId,p_event:data.event,p_id:data.id as string,p_revision:data.revision,p_data:data.fields});
 if(error)fail(error.message);await projectAccess();return z.object({id:z.string().uuid(),replayed:z.boolean()}).parse(result);
});
export const addProjectHistory=createServerFn({method:'POST'}).inputValidator(i=>historyInput.parse(i)).handler(async({data})=>{
 const {projectAccess}=await import('./crm-projects.server');const {db,actor}=await projectAccess();
 const {error}=await db.rpc('add_crm_project_history',{p_author:actor.userId,p_event:data.event,p_project:data.projectId,p_kind:data.kind,p_content:data.content});
 if(error)fail(error.message);await projectAccess();return {ok:true};
});
