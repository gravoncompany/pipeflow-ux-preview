import { z } from 'zod';
export const PROJECT_STATUSES = { planejado: 'Planejado', em_desenvolvimento: 'Em desenvolvimento', em_teste: 'Em teste', concluido: 'Concluído', bloqueado: 'Bloqueado' } as const;
export const PROJECT_PRIORITIES = { alta: 'Alta', media: 'Média', baixa: 'Baixa' } as const;
export const PROJECT_CATEGORIES = { integracao: 'Integração', melhoria: 'Melhoria', automacao: 'Automação', financeiro: 'Financeiro', conteudo: 'Conteúdo', produto: 'Produto' } as const;
const text = (max: number) => z.string().trim().max(max);
export const projectFields = z.object({
 name: text(160).min(2), objective: text(2000), description: text(16000), category: z.enum(['integracao','melhoria','automacao','financeiro','conteudo','produto']),
 priority: z.enum(['alta','media','baixa']), status: z.enum(['planejado','em_desenvolvimento','em_teste','concluido','bloqueado']), responsible: text(160),
 tasks: z.array(z.object({ id: z.string().uuid(), title: text(300).min(1), stage: text(160), done: z.boolean() }).strict()).max(100),
 technicalPending: text(8000), testResults: text(8000), nextAction: text(2000),
}).strict();
export const projectInput = z.object({ id: z.string().uuid().nullable(), revision: z.number().int().nonnegative(), event: z.string().uuid(), fields: projectFields }).strict().superRefine((v,c) => {
 if(v.fields.status==='concluido'&&!v.fields.testResults.trim()) c.addIssue({code:'custom',path:['fields','testResults'],message:'Registre a comprovação e os resultados dos testes antes de concluir.'});
});
export const historyInput = z.object({ projectId:z.string().uuid(), event:z.string().uuid(), kind:z.enum(['decisao','prompt','problema','solucao','teste']), content:text(16000).min(1) }).strict();
export type ProjectFields = z.infer<typeof projectFields>;
export type Project = ProjectFields & { id:string; revision:number; createdAt:string; updatedAt:string };
export const emptyProject: ProjectFields = {name:'',objective:'',description:'',category:'melhoria',priority:'media',status:'planejado',responsible:'',tasks:[],technicalPending:'',testResults:'',nextAction:''};
export function mayAccessProjects(full:boolean, admin:boolean, company:string|null) { return full && admin && company==='crm:1'; }
export function projectFromRow(r: Record<string, unknown>): Project {
 return {...projectFields.parse({name:r.name,objective:r.objective,description:r.description,category:r.category,priority:r.priority,status:r.status,responsible:r.responsible,tasks:r.tasks,technicalPending:r.technical_pending,testResults:r.test_results,nextAction:r.next_action}),id:String(r.id),revision:Number(r.revision),createdAt:String(r.created_at),updatedAt:String(r.updated_at)};
}
