import { z } from "zod";

// Ações em massa (lógica pura, compartilhada entre Prospecção B2B e pipelines). Nada aqui inventa dados:
// e-mails e telefones vêm apenas dos registros selecionados.

const emailSchema = z.string().email().max(254);
// E-mails válidos, sem vazios e sem duplicados (comparação sem diferenciar maiúsculas), na ordem em que aparecem.
export function collectEmails(values: (string | null | undefined | (string | null | undefined)[])[]): { emails: string[]; invalid: number; duplicates: number } {
  const seen = new Set<string>(); const emails: string[] = []; let invalid = 0, duplicates = 0;
  for (const value of values.flat()) {
    for (const part of String(value ?? "").split(/[;,\s]+/)) {
      const email = part.trim().toLowerCase();
      if (!email) continue;
      if (!emailSchema.safeParse(email).success) { invalid++; continue; }
      if (seen.has(email)) { duplicates++; continue; }
      seen.add(email); emails.push(email);
    }
  }
  return { emails, invalid, duplicates };
}
// Formato aceito pelo Gmail nos campos Para/Cc/Cco.
export const gmailList = (emails: string[]) => emails.join(", ");

// Telefones brasileiros normalizados (somente dígitos, 10 a 13), sem duplicados.
export function collectPhones(values: (string | null | undefined | (string | null | undefined)[])[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const value of values.flat()) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13 || /^(\d)\1+$/.test(digits)) continue;
    const key = digits.length >= 12 && digits.startsWith("55") ? digits.slice(2) : digits;
    if (seen.has(key)) continue;
    seen.add(key); out.push(digits);
  }
  return out;
}

// CSV compatível com Excel em português (separador ';', BOM UTF-8) e protegido contra injeção de fórmulas.
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map(r => r.map(cell).join(";")).join("\r\n");
}

// Seleção: alterna, seleciona conjunto (sem duplicar) e remove conjunto.
export function selectMany(current: string[], ids: string[]): string[] { const set = new Set(current); for (const id of ids) set.add(id); return [...set]; }
// Confirmações destrutivas capturam somente os ids selecionados que ainda pertencem ao funil aberto.
export function selectedExistingIds(selected: string[], currentIds: string[]): string[] { const current = new Set(currentIds); return [...new Set(selected)].filter(id => current.has(id)); }
export function unselectMany(current: string[], ids: string[]): string[] { const drop = new Set(ids); return current.filter(id => !drop.has(id)); }
export function toggleOne(current: string[], id: string, checked: boolean): string[] { return checked ? selectMany(current, [id]) : unselectMany(current, [id]); }

// Divide em lotes (ex.: 20 por importação, 40 por movimentação).
export function chunk<T>(items: T[], size: number): T[][] { const out: T[][] = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }

// Resumo de operação em massa no formato pedido.
export type BulkSummary = { selected: number; done: number; existing: number; failed: number; reasons: string[] };
export function bulkSummaryText(s: BulkSummary, verb = "cadastradas"): string {
  const lines = [`${s.selected} empresa(s) selecionada(s).`, `${s.done} ${verb}.`];
  if (s.existing) lines.push(`${s.existing} já existente(s).`);
  if (s.failed) lines.push(`${s.failed} não ${verb}${s.reasons.length ? ` (${[...new Set(s.reasons)].slice(0, 3).join("; ")})` : ""}.`);
  return lines.join(" ");
}
