import { createServer } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildQuery } from './query.mjs';
const { default: postgres } = await import('postgres');
const readSecret = async (name) => process.env[`${name}_FILE`] ? (await readFile(process.env[`${name}_FILE`], 'utf8')).trim() : process.env[name];
const token = await readSecret('RECEITA_API_TOKEN'), database = await readSecret('DATABASE_URL');
const competence = process.env.RECEITA_COMPETENCE, updatedAt = process.env.RECEITA_UPDATED_AT;
if (!token || !database || !/^\d{4}-\d{2}$/.test(competence ?? '') || !updatedAt || !Number.isFinite(Date.parse(updatedAt))) throw new Error('Missing deployment configuration');
let catalog = [];
if (process.env.CNAE_CATALOG_FILE) {
  catalog = JSON.parse(await readFile(process.env.CNAE_CATALOG_FILE, 'utf8'));
  if (!Array.isArray(catalog) || catalog.length > 10000 || catalog.some(r => !/^\d{7}$/.test(r.codigo) || typeof r.descricao !== 'string' || r.descricao.length > 700)) throw new Error('Invalid authoritative CNAE catalogue');
}
const sql = postgres(database, { max: 4, connect_timeout: 5, idle_timeout: 20, connection: { default_transaction_read_only: 'on', statement_timeout: '10000', application_name: 'pipeflow_receita_readonly' } });
const columns = ['cnpj','razao_social','nome_fantasia','cnae_principal','situacao_cadastral','municipio_codigo','municipio','uf','endereco','cep','telefone','email','porte','data_abertura'];
const schema = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='estabelecimentos_sc'`;
if (columns.some(c => !schema.some(r => r.column_name === c))) throw new Error('Verify required table columns before deployment');
for (const c of ['cnpj','cnae_principal','situacao_cadastral','municipio_codigo','municipio','uf','razao_social','nome_fantasia','telefone','email']) if (!schema.some(r => r.column_name === c && ['text','character varying','character'].includes(r.data_type))) throw new Error('Verify indexed filter column types before deployment');
const expected = createHash('sha256').update(token).digest();
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(JSON.stringify(body)); };
createServer(async (req, res) => {
  try {
    const supplied = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    if (!timingSafeEqual(expected, createHash('sha256').update(supplied.startsWith('Bearer ') ? supplied.slice(7) : '').digest())) return send(res, 401, { error:'unauthorized' });
    if (req.method !== 'GET' || (req.url ?? '').length > 4096) return send(res, 405, { error:'invalid_request' });
    const url = new URL(req.url, 'http://api'); if (url.pathname !== '/v1/estabelecimentos') return send(res, 404, { error:'not_found' });
    const allowed = ['cnae','segment','municipality','uf','status','tradeName','legalName','cnpj','hasPhone','hasEmail','page','pageSize'];
    for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) return send(res, 400, { error:'invalid_filter' });
    let query; try { query = buildQuery(Object.fromEntries(url.searchParams), catalog); } catch (e) { return send(res, 400, { error: e.message === 'cnae_catalog_pending' ? 'cnae_catalog_pending' : 'invalid_filter' }); }
    const output = await sql.begin('read only isolation level repeatable read', async tx => {
      const totals = await tx.unsafe(`SELECT count(*)::text AS total FROM public.estabelecimentos_sc WHERE ${query.where}`, query.params);
      const rows = await tx.unsafe(`SELECT ${columns.map(c => `${c}::text AS ${c}`).join(',')} FROM public.estabelecimentos_sc WHERE ${query.where} ORDER BY cnpj LIMIT $${query.params.length+1} OFFSET $${query.params.length+2}`, [...query.params, query.pageSize, query.offset]);
      return { total: Number(totals[0].total), rows: rows.map(r => ({ ...r, cnae_descricao: catalog.find(c => c.codigo === r.cnae_principal)?.descricao ?? null })) };
    });
    send(res, 200, { ...output, page:query.page, pageSize:query.pageSize, competence, updatedAt:new Date(updatedAt).toISOString() });
  } catch { send(res, 503, { error:'query_unavailable' }); }
}).listen(3000, '0.0.0.0');
