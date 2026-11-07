/** Planilha financeira → configurações de recebimento. Somente leitura do arquivo; nada é salvo sem confirmação. */
export type ImportFrequency = "mensal" | "quinzenal" | "semanal";
export type ImportRow = {
 line: number;
 cliente: string;
 descricao: string;
 valor: number; // centavos
 frequencia: ImportFrequency | "";
 dia: number;
 dia2: number;
 inicio: string;
 fim: string;
 problemas: string[];
};

const MAX_ROWS = 500;

/** CSV com aspas; detecta separador ; , ou tabulação pela linha de cabeçalho. */
export function parseCsvText(text: string): string[][] {
 const rows: string[][] = [];
 let field = "", row: string[] = [], quoted = false;
 const push = () => { row.push(field); field = ""; };
 const pushRow = () => { push(); if (row.some(c => c.trim())) rows.push(row); row = []; };
 const sep = (() => { const head = text.slice(0, text.indexOf("\n") + 1 || text.length); const counts = [";", ",", "\t"].map(s => [s, head.split(s).length] as const); counts.sort((a, b) => b[1] - a[1]); return counts[0][1] > 1 ? counts[0][0] : ";"; })();
 for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  if (quoted) {
   if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
  } else if (ch === '"') quoted = true;
  else if (ch === sep) push();
  else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; pushRow(); }
  else field += ch;
 }
 pushRow();
 return rows.slice(0, MAX_ROWS + 1);
}

const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Localiza colunas por nomes comuns da planilha financeira. */
export function mapColumns(headers: string[]): Record<string, number> {
 const find = (...keys: string[]) => headers.findIndex(h => keys.some(k => norm(h).includes(k)));
 return {
  cliente: find("cliente", "empresa", "nome"),
  valor: find("valor", "mensalidade", "semanal", "quinzenal", "preco"),
  frequencia: find("frequencia", "recorrencia", "periodicidade", "plano"),
  dia: find("vencimento", "dia"),
  descricao: find("descricao", "servico", "contrato", "obs"),
 };
}

/** "R$ 1.400,50" | "1400.50" | "350" → centavos; 0 quando inválido. */
export function parseMoneyBR(value: string): number {
 const clean = value.replace(/[^\d,.-]/g, "").trim();
 if (!clean) return 0;
 const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
 const n = Number(normalized);
 return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export function parseFrequency(value: string): ImportFrequency | "" {
 const v = norm(value);
 if (v.includes("seman")) return "semanal";
 if (v.includes("quinzen")) return "quinzenal";
 if (v.includes("mens")) return "mensal";
 return "";
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
export function parseDateBR(value: string): string {
 const v = value.trim();
 if (dateRe.test(v)) return v;
 const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
 if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
 return "";
}

/** Converte a matriz (cabeçalho + linhas) em cobranças recorrentes candidatas, sem inventar dados. */
export function buildImportRows(matrix: string[][], year: number): { rows: ImportRow[]; headers: string[] } {
 if (!matrix.length) return { rows: [], headers: [] };
 const headers = matrix[0];
 const cols = mapColumns(headers);
 const rows: ImportRow[] = [];
 for (let i = 1; i < matrix.length && rows.length < MAX_ROWS; i++) {
  const cells = matrix[i];
  const get = (idx: number) => (idx >= 0 ? String(cells[idx] ?? "").trim() : "");
  const cliente = get(cols.cliente);
  const valor = parseMoneyBR(get(cols.valor));
  let frequencia = parseFrequency(get(cols.frequencia));
  const diaRaw = get(cols.dia);
  const dias = (diaRaw.match(/\d{1,2}/g) ?? []).map(Number).filter(d => d >= 1 && d <= 31);
  if (!frequencia && dias.length >= 2) frequencia = "quinzenal";
  const problemas: string[] = [];
  if (!cliente) problemas.push("Cliente não identificado");
  if (!valor) problemas.push("Valor ausente ou inválido");
  if (!frequencia) problemas.push("Frequência não reconhecida");
  if (frequencia !== "semanal" && !dias.length) problemas.push("Dia de vencimento ausente");
  rows.push({
   line: i + 1,
   cliente,
   descricao: get(cols.descricao) || `${frequencia === "semanal" ? "Pagamento semanal" : frequencia === "quinzenal" ? "Pagamento quinzenal" : "Mensalidade"} · ${cliente}`,
   valor,
   frequencia,
   dia: dias[0] ?? 10,
   dia2: dias[1] ?? 25,
   inicio: parseDateBR(get(-1)) || `${year}-01-01`,
   fim: `${year}-12-31`,
   problemas,
  });
 }
 return { rows, headers };
}
