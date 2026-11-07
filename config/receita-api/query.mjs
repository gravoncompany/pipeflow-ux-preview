export function buildQuery(input, catalog = []) {
  const clauses = [], params = [];
  const bind = value => { params.push(value); return `$${params.length}`; };
  const text = key => { const value = input[key] ?? ''; if (typeof value !== 'string' || value.length > 150) throw new Error('invalid_filter'); return value.trim(); };
  const exact = (column, value) => { if (value) clauses.push(`${column} = ${bind(value)}`); };
  const escape = value => value.replace(/[\\%_]/g, c => `\\${c}`);
  const like = (column, value) => { if (value) clauses.push(`${column} ILIKE ${bind(`%${escape(value)}%`)} ESCAPE '\\'`); };
  const page = Number(input.page ?? 1), pageSize = Number(input.pageSize ?? 50);
  if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('invalid_page');
  if ((input.uf ?? 'SC') !== 'SC') throw new Error('invalid_uf');
  exact('uf', 'SC');
  const cnpj = text('cnpj').replace(/[./\s-]/g, '');
  if (cnpj && !/^\d{14}$/.test(cnpj)) throw new Error('invalid_cnpj');
  exact('cnpj', cnpj);
  const status = text('status'); if (status && !['01','02','03','04','08'].includes(status)) throw new Error('invalid_status'); exact('situacao_cadastral', status);
  const municipality = text('municipality'); if (/^\d+$/.test(municipality)) exact('municipio_codigo', municipality); else like('municipio', municipality);
  like('razao_social', text('legalName')); like('nome_fantasia', text('tradeName'));
  const cnae = text('cnae'), segment = text('segment');
  if (cnae && /^[\d\s./-]+$/.test(cnae)) { const code = cnae.replace(/\D/g, ''); if (code.length !== 7) throw new Error('invalid_cnae'); exact('cnae_principal', code); }
  const terms = [cnae && !/^[\d\s./-]+$/.test(cnae) ? cnae : '', segment].filter(Boolean);
  for (const term of terms) {
    if (!catalog.length) throw new Error('cnae_catalog_pending');
    const codes = catalog.filter(r => r.descricao.toLocaleLowerCase('pt-BR').includes(term.toLocaleLowerCase('pt-BR'))).map(r => r.codigo);
    if (!codes.length) clauses.push('FALSE'); else clauses.push(`cnae_principal = ANY(${bind(codes)}::text[])`);
  }
  for (const [key, column] of [['hasPhone','telefone'], ['hasEmail','email']]) {
    const value = input[key] ?? 'false'; if (!['true','false',true,false].includes(value)) throw new Error('invalid_boolean');
    if (value === 'true' || value === true) clauses.push(`${column} IS NOT NULL AND btrim(${column}) <> ''`);
  }
  return { where: clauses.join(' AND '), params, page, pageSize, offset: (page - 1) * pageSize };
}
