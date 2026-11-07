import { z } from 'zod';
export const polpInstitutionSchema = z.object({
 id:z.string().min(1).max(128),name:z.string().min(1).max(200),
 status:z.enum(['OPERATIONAL','MAJOR_OUTAGE','DEGRADED_PERFORMANCE']),
 type:z.enum(['PERSONAL','BUSINESS','BOTH']),credentials:z.array(z.enum(['cpf','cnpj'])).max(2),
});
export const polpCatalogSchema=z.object({data:z.array(polpInstitutionSchema).max(1000),links:z.object({next:z.string().nullable().optional()}).optional(),meta:z.object({next_cursor:z.string().nullable().optional()}).optional()});
export type PolpInstitution=z.infer<typeof polpInstitutionSchema>;
export type PolpResult={credentialsConfigured:boolean;authentication:'not_verified'|'rejected';status:'ok'|'missing_credentials'|'http_error'|'invalid_response'|'unavailable';httpStatus:number|null;institutions:PolpInstitution[];complete:boolean;nubankBusiness:'available'|'unavailable'|'not_found'|'unknown'};
export function nubankBusinessStatus(rows:PolpInstitution[],complete:boolean):PolpResult['nubankBusiness'] {
 const business=rows.filter(r=>/^nubank(?:\s|$)/i.test(r.name)&&['BUSINESS','BOTH'].includes(r.type)&&r.credentials.includes('cpf')&&r.credentials.includes('cnpj'));
 if(business.some(r=>r.status==='OPERATIONAL'))return 'available';
 return business.length?'unavailable':complete?'not_found':'unknown';
}

// Consentimento Open Finance (somente leitura: contas, saldos e transações).
export const polpConsentStatusSchema=z.enum(['AWAITING_AUTHORIZATION','AUTHORISED','REJECTED','EXPIRED']);
export const polpExecutionStatusSchema=z.enum(['AWAITING_RESOURCES','SUCCESS','PARTIAL_SUCCESS']);
// A Polp devolve o recurso dentro de {data:{...}} (POST/GET /consents/{id}); campos extras são ignorados
// e valores auxiliares desconhecidos viram null, para nunca perder um consentimento já criado.
const polpConsentObject=z.object({
 id:z.string().min(8).max(128),institution_id:z.string().min(1).max(128),
 // Vínculo opaco (HMAC dos documentos) gravado na criação; nunca contém CPF/CNPJ em claro.
 cliente_user_id:z.string().max(200).nullable().optional().catch(null),
 status:polpConsentStatusSchema,execution_status:polpExecutionStatusSchema.nullable().optional().catch(null),
 products:z.array(z.string().max(40)).max(20).optional().catch(undefined),
 url_to_authenticate:z.string().url().max(4000).refine(u=>u.startsWith('https://')).nullable().optional().catch(null),
 url_to_authenticate_expires_at:z.string().max(40).nullable().optional().catch(null),
 created_at:z.string().max(40).nullable().optional().catch(null),
 // Rótulo e erro da Polp saem do parser já sanitizados (sem documentos, e-mails ou links).
 status_label:z.unknown().transform(v=>sanitizePolpText(v)),
 error:z.unknown().transform(v=>polpConsentErrorDetail(v)),
});
export const polpConsentSchema=z.preprocess(v=>v&&typeof v==='object'&&'data' in v&&!('id' in v)?(v as {data:unknown}).data:v,polpConsentObject);
export const polpConsentListSchema=z.object({data:z.array(z.unknown()).max(200),meta:z.object({next_cursor:z.string().max(500).nullable().optional()}).nullable().optional().catch(null)});
export type PolpConsent=z.infer<typeof polpConsentSchema>;
// Contas e transações conforme a documentação Polp v2 (GET /consents/{id}/accounts e GET /accounts/{id}/transactions).
// Campos auxiliares desconhecidos viram null em vez de descartar o registro; cada item é validado individualmente.
// Open Finance Brasil envia `amount` como string decimal com 2 a 4 casas (ex.: "250.0000"); número é aceito e convertido.
// Moeda ausente/vazia é tratada como BRL (contas Nubank PJ são em reais); a comparação ignora caixa e espaços.
export const polpMoneySchema=z.object({amount:z.union([z.string().max(40),z.number().finite()]).transform(v=>String(v).trim()),currency:z.string().max(8).nullable().optional().transform(v=>(v??'').trim().toUpperCase()||'BRL')});
const optionalMoney=polpMoneySchema.nullable().optional().catch(null);
export const polpAccountSchema=z.object({
 id:z.string().min(1).max(128),consent_id:z.string().max(128).optional(),
 number:z.string().max(32).nullable().optional().catch(null),branch_code:z.string().max(16).nullable().optional().catch(null),check_digit:z.string().max(8).nullable().optional().catch(null),
 type:z.string().max(60).nullable().optional().catch(null),subtype:z.string().max(60).nullable().optional().catch(null),currency:z.string().max(8).nullable().optional().catch(null),
 balance:z.object({
  update_date_time:z.string().max(40).nullable().optional().catch(null),
  has_reserved_balance:z.boolean().nullable().optional().catch(null),
  available_amount:optionalMoney,blocked_amount:optionalMoney,automatically_invested_amount:optionalMoney,
 }).nullable().optional().catch(null),
});
export type PolpAccount=z.infer<typeof polpAccountSchema>;
export const polpTransactionSchema=z.object({
 id:z.string().min(1).max(128),account_id:z.string().max(128).optional(),
 transaction_name:z.string().max(300).nullable().optional().catch(null),
 transaction_date_time:z.string().max(40).nullable().optional().catch(null),
 type:z.string().max(60).nullable().optional().catch(null),
 // Valor real da Polp: CREDITO/DEBITO. Desconhecido vira null e fica fora dos totais (nunca adivinha o sentido).
 credit_debit_type:z.enum(['CREDITO','DEBITO']).nullable().optional().catch(null),
 transaction_amount:optionalMoney,
 category_ref:z.string().max(80).nullable().optional().catch(null),
 counterparty:z.object({name:z.string().max(200).nullable().optional(),alias:z.string().max(200).nullable().optional()}).nullable().optional().catch(null),
});
export type PolpTransaction=z.infer<typeof polpTransactionSchema>;
// Somente servidor (sincronização persistente): inclui o documento da contraparte para gerar o HMAC e datas do provedor.
// O documento é descartado logo após o HMAC; este schema nunca é usado em respostas ao navegador.
export const polpTransactionSyncSchema=polpTransactionSchema.extend({
 partie_cnpj_cpf:z.string().max(20).nullable().optional().catch(null),
 partie_person_type:z.enum(['PESSOA_NATURAL','PESSOA_JURIDICA']).nullable().optional().catch(null),
 created_at:z.string().max(40).nullable().optional().catch(null),
 updated_at:z.string().max(40).nullable().optional().catch(null),
});
export type PolpTransactionSync=z.infer<typeof polpTransactionSyncSchema>;
// Página genérica: itens validados um a um; inválidos são contados, nunca derrubam a página inteira.
export const polpPageSchema=z.object({data:z.array(z.unknown()).max(1000),meta:z.object({next_cursor:z.string().max(500).nullable().optional()}).nullable().optional().catch(null)});

// Valores monetários com precisão decimal exata (BigInt em micro-reais): aceita até 6 casas decimais, sinal opcional e
// sem separador de milhar. Formato inválido → null. Arredondamento para centavos só no resultado final.
const MONEY_SCALE=6;
export function moneyToUnits(value:{amount:string;currency?:string|null}|null|undefined):bigint|null{
 const raw=value?.amount?.trim();
 if(!raw)return null;
 const m=/^([+-])?(\d{1,15})(?:\.(\d{1,6}))?$/.exec(raw);
 if(!m)return null;
 const units=BigInt(m[2])*10n**BigInt(MONEY_SCALE)+BigInt(((m[3]??'')+'000000').slice(0,MONEY_SCALE));
 return m[1]==='-'?-units:units;
}
// Arredonda micro-reais para centavos (meio para longe do zero).
export function unitsToCents(units:bigint):number{
 const step=10n**BigInt(MONEY_SCALE-2),half=step/2n;
 const abs=units<0n?-units:units;
 const cents=(abs+half)/step;
 return Number(units<0n?-cents:cents);
}
export function moneyToCents(value:{amount:string;currency?:string|null}|null|undefined):number|null{
 const units=moneyToUnits(value);
 return units===null?null:unitsToCents(units);
}
export function isBrl(currency:string|null|undefined):boolean{return ((currency??'').trim().toUpperCase()||'BRL')==='BRL';}
export type PolpTransactionSummary={incomeCents:number;expenseCents:number;netCents:number;counted:number;excluded:number;excludedInvalidAmount:number;excludedNonBrl:number;excludedNoDirection:number};
// Entradas/saídas/resultado do período. Sentido vem de credit_debit_type (CREDITO/DEBITO); valor em módulo.
// Soma exata em micro-reais e arredondamento único ao final. Exclusões são contadas por motivo para a interface avisar.
export function summarizeTransactions(rows:PolpTransaction[]):PolpTransactionSummary{
 let income=0n,expense=0n,counted=0,invalidAmount=0,nonBrl=0,noDirection=0;
 for(const t of rows){
  const units=moneyToUnits(t.transaction_amount);
  if(units===null){invalidAmount++;continue;}
  if(!isBrl(t.transaction_amount?.currency)){nonBrl++;continue;}
  if(t.credit_debit_type!=='CREDITO'&&t.credit_debit_type!=='DEBITO'){noDirection++;continue;}
  const abs=units<0n?-units:units;
  if(t.credit_debit_type==='CREDITO')income+=abs;else expense+=abs;
  counted++;
 }
 const excluded=invalidAmount+nonBrl+noDirection;
 return {incomeCents:unitsToCents(income),expenseCents:unitsToCents(expense),netCents:unitsToCents(income-expense),counted,excluded,excludedInvalidAmount:invalidAmount,excludedNonBrl:nonBrl,excludedNoDirection:noDirection};
}

// Sanitização compartilhada: mascara e-mails, links e sequências numéricas (CPF/CNPJ/contas).
export function sanitizePolpText(value:unknown):string|null{
 if(typeof value!=='string'||!value)return null;
 return value.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g,'[email]').replace(/https?:\/\/\S+/g,'[url]').replace(/\d[\d.\-/]{6,}\d/g,'[número]').slice(0,300);
}
// Resume o campo `error` do consentimento (formato não documentado) apenas com textos curtos sanitizados.
export function polpConsentErrorDetail(error:unknown):string|null{
 if(typeof error==='string')return sanitizePolpText(error);
 if(!error||typeof error!=='object'||Array.isArray(error))return null;
 const o=error as Record<string,unknown>;
 const parts=[o.code,o.title,o.message,o.description].map(v=>sanitizePolpText(v)).filter((v):v is string=>Boolean(v));
 return parts.length?[...new Set(parts)].join(' · ').slice(0,300):null;
}

// Validade do link de autorização (a Polp emite links com validade de 1 hora). Margem de segurança evita
// abrir um link que expiraria durante o login no banco. Sem data de expiração válida, o link não é exibido.
export const AUTH_URL_SAFETY_MARGIN_MS=2*60*1000;
export type AuthLinkState='valid'|'expired'|'unknown';
export function authLinkState(expiresAt:string|null|undefined,now:number=Date.now()):AuthLinkState{
 if(!expiresAt)return 'unknown';
 const t=Date.parse(expiresAt);
 if(Number.isNaN(t))return 'unknown';
 return t-AUTH_URL_SAFETY_MARGIN_MS>now?'valid':'expired';
}
// Só devolve o link se o consentimento aguarda autorização e o link ainda está dentro da validade.
export function usableAuthUrl(consent:{status:string;url_to_authenticate?:string|null;url_to_authenticate_expires_at?:string|null},now:number=Date.now()):string|null{
 if(consent.status!=='AWAITING_AUTHORIZATION'||!consent.url_to_authenticate)return null;
 return authLinkState(consent.url_to_authenticate_expires_at,now)==='valid'?consent.url_to_authenticate:null;
}
// Um novo link só pode ser gerado quando não há autorização ativa nem link válido.
// Consentimentos AUTHORISED nunca são recriados: a recriação revogaria a conexão ativa.
export function canRecreateConsent(status:string,expiresAt:string|null|undefined,now:number=Date.now()):boolean{
 if(status==='REJECTED'||status==='EXPIRED')return true;
 return status==='AWAITING_AUTHORIZATION'&&authLinkState(expiresAt,now)!=='valid';
}

// Escolhe um consentimento existente da instituição para reaproveitar, sem criar solicitação duplicada:
// autorizado primeiro, depois aguardando autorização; recusados/expirados só são candidatos à renovação explícita.
export function selectExistingConsent<T extends {institution_id:string;status:string;created_at?:string|null}>(consents:T[],institutionId:string):{kind:'active'|'renewable';consent:T}|null{
 const rows=consents.filter(c=>c.institution_id===institutionId).sort((a,b)=>(Date.parse(b.created_at??'')||0)-(Date.parse(a.created_at??'')||0));
 const active=rows.find(c=>c.status==='AUTHORISED')??rows.find(c=>c.status==='AWAITING_AUTHORIZATION');
 if(active)return {kind:'active',consent:active};
 const renewable=rows.find(c=>c.status==='REJECTED'||c.status==='EXPIRED');
 return renewable?{kind:'renewable',consent:renewable}:null;
}
// Orientação objetiva por situação do consentimento; nunca contém documentos ou links.
export function consentGuidance(status:string,expiresAt:string|null|undefined,now:number=Date.now()):string|null{
 if(status==='AUTHORISED')return null;
 if(status==='REJECTED')return 'A autorização foi recusada ou cancelada no banco. Gere um novo link de autorização para tentar novamente.';
 if(status==='EXPIRED')return 'O consentimento expirou. Gere um novo link de autorização para reconectar a conta.';
 if(status==='AWAITING_AUTHORIZATION'&&authLinkState(expiresAt,now)!=='valid')return 'O link de autorização expirou (validade de 1 hora). Gere um novo link de autorização; links antigos mostram erro na página do Nubank.';
 return null;
}

export type PolpConsentView={id:string;consentId:string;institutionName:string;status:z.infer<typeof polpConsentStatusSchema>;executionStatus:string|null;urlExpiresAt:string|null;lastCheckedAt:string};
// Mensagens de erro por causa (sem prosa do provedor, documentos ou links).
export function polpAccessErrorMessage(httpStatus:number|null):string|null{
 if(httpStatus===401)return 'Credenciais da Polp recusadas.';
 if(httpStatus===402)return 'Assinatura da Polp inativa ou fatura pendente.';
 if(httpStatus===403)return 'Conta Polp pendente de aprovação para produção.';
 if(httpStatus===429)return 'Limite de requisições da Polp atingido (HTTP 429). Aguarde antes de tentar.';
 if(httpStatus&&httpStatus>=500)return `Falha temporária na Polp (HTTP ${httpStatus}).`;
 return null;
}
export function polpCreateErrorMessage(reason:string,httpStatus:number|null):string{
 if(reason==='missing_credentials')return 'Credenciais da Polp não configuradas.';
 if(reason==='timeout')return 'A Polp não respondeu a tempo. Antes de tentar de novo, atualize a lista: o consentimento pode ter sido criado.';
 if(reason==='unavailable')return 'Não foi possível contatar a Polp. Nenhuma confirmação foi recebida.';
 if(reason==='invalid_response')return 'A Polp respondeu em formato inesperado. O consentimento pode ter sido criado; não tente de novo antes de verificar.';
 const access=polpAccessErrorMessage(httpStatus);if(access)return access;
 if(httpStatus===400||httpStatus===422)return `A Polp recusou os dados enviados (HTTP ${httpStatus}). Confira CPF do representante e CNPJ.`;
 if(httpStatus===409)return 'A Polp indicou conflito com um consentimento existente (HTTP 409).';
 return `A Polp recusou a criação do consentimento${httpStatus?` (HTTP ${httpStatus})`:''}.`;
}
export function polpRecreateErrorMessage(reason:string,httpStatus:number|null):string{
 if(reason==='missing_credentials')return 'Credenciais da Polp não configuradas.';
 if(reason==='timeout')return 'A Polp não respondeu a tempo. Use "Atualizar status" antes de tentar de novo: o novo link pode ter sido gerado.';
 if(reason==='unavailable')return 'Não foi possível contatar a Polp. Nenhum novo link foi confirmado.';
 if(reason==='invalid_response')return 'A Polp respondeu em formato inesperado. Use "Atualizar status" antes de tentar de novo.';
 const access=polpAccessErrorMessage(httpStatus);if(access)return access;
 if(httpStatus===404)return 'Consentimento não encontrado na Polp (HTTP 404). Nenhum novo link foi gerado.';
 if(httpStatus===422)return 'A Polp não pôde renovar este consentimento (HTTP 422): o registro pode não ter o CPF do representante. Nenhum novo link foi gerado.';
 if(httpStatus===409)return 'A Polp indicou conflito ao renovar (HTTP 409). Atualize o status antes de tentar de novo.';
 return `A Polp recusou a renovação do link${httpStatus?` (HTTP ${httpStatus})`:''}.`;
}
export function polpReadErrorMessage(reason:string,httpStatus:number|null):string{
 if(reason==='missing_credentials')return 'Credenciais da Polp não configuradas.';
 if(reason==='timeout')return 'A Polp não respondeu a tempo.';
 const access=polpAccessErrorMessage(httpStatus);if(access)return access;
 if(httpStatus===404)return 'Consentimento não encontrado na Polp (HTTP 404).';
 return httpStatus?`Não foi possível consultar o status na Polp (HTTP ${httpStatus}).`:'Não foi possível consultar o status na Polp agora.';
}

// Detalhe exibido após atualizar/criar/renovar: textos da Polp já sanitizados, nunca documentos ou URLs.
export type PolpConsentDetail={statusLabel:string|null;error:string|null};
export function consentStatusLabel(status:PolpConsentView['status']):string {
 return {AWAITING_AUTHORIZATION:'Aguardando autorização',AUTHORISED:'Conta conectada',REJECTED:'Autorização recusada',EXPIRED:'Consentimento expirado'}[status];
}
export function validCpf(value:string):boolean{return /^\d{11}$/.test(value);}
export function validCnpj(value:string):boolean{return /^\d{14}$/.test(value);}
export function onlyDigits(value:string):string{return value.replace(/\D/g,'').slice(0,14);}