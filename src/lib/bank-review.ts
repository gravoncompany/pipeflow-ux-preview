import { categoryAllowed, normalizeText, type BankKind, type Classification, type CostCategory } from './bank-classification';

export type ReviewIdentity = { transactionId: string; accountId: string; payerHmac: string | null; counterparty: string | null; description: string | null; direction: string | null; amountCents: number | null; transactionAt: string | null };
export type ApprovedExample = ReviewIdentity & { kind: BankKind; category: CostCategory | null; vendor: string | null; clientId: string | null };
export function learnedBankSuggestion(row: ReviewIdentity, examples: ApprovedExample[]): (Classification & { clientId: string | null; reason: string }) | null {
  const party = normalizeText(row.counterparty), desc = normalizeText(row.description);
  const matches = examples.filter(e => e.transactionId !== row.transactionId && e.accountId === row.accountId && e.direction === row.direction && (
    row.payerHmac ? e.payerHmac === row.payerHmac : !e.payerHmac && party.length >= 4 && normalizeText(e.counterparty) === party && desc.length >= 8 && normalizeText(e.description) === desc
  ));
  const first = matches[0];
  if (!first || !categoryAllowed(first.kind, first.category) || !matches.every(e => e.kind === first.kind && e.category === first.category && e.clientId === first.clientId)) return null;
  const dates = [...new Set(matches.map(e => e.transactionAt?.slice(0, 10)).filter(Boolean))].sort();
  const recurring = dates.length >= 2;
  const amount = row.amountCents;
  const compatibleValue = amount !== null && matches.some(e => e.amountCents !== null && Math.abs(e.amountCents - amount) <= Math.abs(amount) * .1);
  return { kind: first.kind, category: first.category, vendor: first.vendor, source: 'historico', clientId: first.clientId,
    confidence: row.payerHmac && recurring && compatibleValue ? 'alta' : 'media',
    reason: `${matches.length} confirmação(ões) compatíveis na mesma conta${row.payerHmac ? ', identidade do pagador conferida' : ', nome e descrição exatos (identidade não comprovada)'}${recurring ? ', recorrência em datas distintas' : ''}.` };
}
export function selectedReviewRows<T extends { id: string }>(rows: T[], ids: ReadonlySet<string>): T[] { return rows.filter(r => ids.has(r.id)); }
export function reviewPage<T>(rows: T[], page: number, size = 40): T[] { return rows.slice(Math.max(0, page) * size, (Math.max(0, page) + 1) * size); }