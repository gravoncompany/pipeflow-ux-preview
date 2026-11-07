import type { CompanyData } from "@/lib/b2b-prospecting";

/** Read-only registration/estimate projection, shared by review and private CRM history. */
export function CompanyFinancialData({ company }: { company: CompanyData }) {
  const p = company.publicDetails;
  const registrySource = p?.registrySource || company.evidence?.find(e => e.kind === "reported")?.source || "Fonte cadastral";
  const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const rows = [
    ["Porte empresarial", p?.companySize || "Não informado"],
    ["Capital social · cadastral, não é faturamento", p?.capital == null ? "Não informado" : money(p.capital)],
    ["CNAE", p?.cnae || "Não informado"],
    ["Data de abertura", p?.openedOn || "Não informada"],
    ["CEP", p?.postalCode || "Não informado"],
  ];
  return <section className="space-y-3" aria-label="Dados cadastrais e faturamento">
    <h4 className="text-sm font-semibold">Dados cadastrais · {registrySource}</h4>
    <dl className="grid gap-3 text-xs sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}</dl>
    <dl className="border-t pt-3 text-xs"><dt className="text-muted-foreground">Faturamento estimado · não comprovado</dt><dd className="mt-1 break-words">{p?.revenueEstimate != null && p.revenueSource ? money(p.revenueEstimate) : "Faixa não disponível em contrato de API verificado"}</dd><dt className="mt-2 text-muted-foreground">Periodicidade</dt><dd className="mt-1">Não informada · não presumir mensal ou anual</dd>{p?.revenueSource && <><dt className="mt-2 text-muted-foreground">Fonte da estimativa</dt><dd className="break-words">{p.revenueSource}</dd></>}</dl>
  </section>;
}