// Leitura de valores digitados à mão no campo "Faturamento".
// Trata "5.000", "5000", "R$ 5.000,00", "10.000.00", "20,000", "15 mil", "1,2 mi".

export function parseRevenue(value: string): number {
  let s = (value || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return 0;

  // "milhão"/"milhões" e a abreviação "mi" valem 1.000.000; "mil" vale 1.000
  let mult = 1;
  if (s.includes("milh")) mult = 1_000_000;
  else if (/\bmil\b|\bmi[ll]\b/.test(s)) mult = 1_000;
  else if (/\bmi\b/.test(s)) mult = 1_000_000;

  s = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return 0;

  // O último separador, seguido de 1 ou 2 dígitos, é casa decimal:
  // "50.000,00" → 50000 | "10.000.00" → 10000 | "1,2" → 1.2
  const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  let intPart = s;
  let frac = 0;
  if (last > -1) {
    const tail = s.slice(last + 1);
    if (/^\d{1,2}$/.test(tail)) {
      intPart = s.slice(0, last);
      frac = parseInt(tail, 10) / (tail.length === 1 ? 10 : 100);
    }
  }

  const digits = intPart.replace(/[^\d]/g, "");
  if (!digits) return frac * mult;
  return Math.round((parseInt(digits, 10) + frac) * mult);
}

export const currency = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
