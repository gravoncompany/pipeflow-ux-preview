import { HYPERCASH_BASE, HYPERCASH_PAYMENTS_BASE } from './hypercash';

export type HypercashApiKind = 'subscriptions' | 'transactions';
export type ApiFailure = { ok: false; http: number | null; code: string };
export function credentialProblem(key: string, kind: HypercashApiKind): string | null {
  if (kind === 'subscriptions' && /^sk/i.test(key)) return 'A chave SK pertence à API de Transações. Para assinaturas, use a chave HCP com permissão subscriptions.';
  if (kind === 'transactions' && /^hcp_/i.test(key)) return 'A API de Transações usa sua própria chave secreta SK, não a chave HCP de assinaturas.';
  if (!key || key.length > 500 || /[\s\x00-\x1f]/.test(key)) return 'Credencial inválida.';
  return null;
}
export function hypercashRequest(path: string, key: string, kind: HypercashApiKind) {
  const base = kind === 'subscriptions' ? HYPERCASH_BASE : HYPERCASH_PAYMENTS_BASE;
  const authorization = kind === 'subscriptions' ? `Bearer ${key}` : `Basic ${btoa(`x:${key}`)}`;
  return { url: `${base}${path}`, init: { method: 'GET', headers: { Authorization: authorization, Accept: 'application/json' }, redirect: 'manual' as const, signal: AbortSignal.timeout(10_000) } };
}
export async function hypercashRead(path: string, key: string, kind: HypercashApiKind = 'subscriptions', request: typeof fetch = fetch): Promise<{ok:true;body:unknown} | ApiFailure> {
  const {url,init}=hypercashRequest(path,key,kind);
  let res: Response;
  try { res=await request(url,init); }
  catch { return {ok:false,http:null,code:init.signal.aborted?'timeout':'network'}; }
  if (!res.ok) { await res.body?.cancel().catch(()=>undefined); return {ok:false,http:res.status,code:res.status===401?'auth':res.status===403?'permission':res.status===429?'rate_limit':res.status>=300&&res.status<400?'redirect':'http'}; }
  try {
    if (!res.body) return {ok:false,http:res.status,code:'schema'};
    const reader=res.body.getReader(); const chunks:Uint8Array[]=[];let size=0;
    for (;;) { const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2_000_000){await reader.cancel();return {ok:false,http:res.status,code:'oversized'};}chunks.push(part.value); }
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const body:unknown=JSON.parse(new TextDecoder().decode(bytes));
    if(!body||typeof body!=='object'||(body as {success?:unknown}).success===false)return {ok:false,http:res.status,code:'schema'};
    return {ok:true,body};
  } catch { return {ok:false,http:res.status,code:init.signal.aborted?'timeout':'schema'}; }
}

/** A complete snapshot or an error: never silently truncate, skip bad rows or repeat a page. */
export async function allHypercashPages<T>(path:string,key:string,map:(raw:unknown)=>T|null,read=hypercashRead):Promise<T[]> {
  const rows:T[]=[];let expectedTotal:number|undefined; const ids=new Set<string>();
  for(let page=1;page<=1000;page++){
    const res=await read(`${path}?page=${page}&limit=100`,key);
    if(!res.ok)throw new Error(`HyperCash: ${res.code}${res.http?` (HTTP ${res.http})`:''}. A sincronização não foi concluída.`);
    const body=res.body as {success?:unknown;data?:unknown;total?:unknown;page?:unknown};
    if(body.success!==true||!Array.isArray(body.data)||body.data.length>100||!Number.isSafeInteger(body.total)||Number(body.total)<0||(body.page!==undefined&&body.page!==page))throw new Error('HyperCash: resposta de paginação inválida.');
    if(expectedTotal===undefined)expectedTotal=Number(body.total);
    if(expectedTotal!==Number(body.total))throw new Error('HyperCash: os dados mudaram durante a consulta. Tente novamente.');
    for(const raw of body.data){const id=raw&&typeof raw==='object'?(raw as {id?:unknown}).id:null;const row=map(raw);if(typeof id!=='string'||ids.has(id)||!row)throw new Error('HyperCash: registro inválido ou página repetida.');ids.add(id);rows.push(row);}
    if(rows.length===expectedTotal)return rows;
    if(rows.length>expectedTotal||body.data.length===0)throw new Error('HyperCash: paginação incompleta.');
  }
  throw new Error('HyperCash: limite de segurança excedido; nenhuma importação parcial foi salva.');
}

export const HYPERCASH_FAILURE_LABEL:Record<string,string>={auth:'Credencial recusada ou expirada.',permission:'A chave não possui a permissão necessária (subscriptions para assinaturas).',rate_limit:'Limite da HyperCash atingido. Aguarde antes de tentar novamente.',timeout:'A HyperCash demorou para responder.',network:'Não foi possível alcançar a HyperCash.',redirect:'A HyperCash redirecionou a consulta; nenhum segredo foi encaminhado.',schema:'Resposta incompatível com o contrato da HyperCash.',oversized:'Resposta excedeu o limite seguro.',http:'A HyperCash está indisponível ou recusou a consulta.'};