// MODO DEMONSTRAÇÃO (somente versão experimental pipeflow-ux-preview).
// Ativado apenas com VITE_UX_DEMO=1. Responde às funções de servidor no próprio navegador com
// dados FICTÍCIOS, para visualizar a interface sem banco de dados. Nenhum dado real, nenhuma
// gravação e nenhum envio: qualquer operação de escrita retorna erro de "modo demonstração".

import { growthMetrics, type GrowthClient, type GrowthHistory } from "@/lib/dashboard-growth";
import { unitEconomics } from "@/lib/dashboard-unit-economics";
import type { OverviewRow } from "@/lib/bank-overview";
import { clientFinance, contractMrr, healthScore, parseManagement } from "@/lib/customer-success-management";
import { B2B_TABLES } from "@/lib/b2b-readiness";

const pad = (n: number) => String(n).padStart(2, "0");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function todayISO() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(d: string, n: number) {
  const v = new Date(`${d}T12:00:00Z`);
  v.setUTCDate(v.getUTCDate() + n);
  return v.toISOString().slice(0, 10);
}

function buildData() {
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const curMonth = Number(today.slice(5, 7));
  const names = ["Clínica Exemplo", "Padaria Modelo", "Academia Demo", "Odonto Teste", "Loja Fictícia", "Estúdio Amostra", "Pet Shop Ilustrativo", "Restaurante Simulado"];
  const statuses = ["ativo", "ativo", "ativo", "implantacao", "ativo", "pausado", "ativo", "encerrado"];
  const contacts = ["Ana", "Bruno", "Carla", "Diego", "Eva", "Fábio", "Gabi", "Hugo"];
  const services = [["Tráfego pago", "Social media"], ["Tráfego pago"], ["Site", "SEO"], ["Tráfego pago"], ["Social media"], ["Tráfego pago"], ["CRM"], ["Site"]];
  const amounts = [180000, 120000, 250000, 90000, 150000, 80000, 110000, 60000];
  const clients = names.map((n, i) => ({
    id: id(i + 1), trade_name: n, legal_name: `${n} Ltda`, status: statuses[i], cnpj: i % 3 ? "00.000.000/0001-00" : "",
    contact_name: contacts[i], whatsapp: "", phone: "", email: i % 2 ? "contato@exemplo.invalid" : "", website: "",
    internal_responsible: i % 2 ? "Responsável B" : "Responsável A", services: services[i], created_at: `${year}-01-10T10:00:00Z`,
    relationship_start: `${year}-02-01`, lead_id: null, address: i % 2 ? "Endereço fictício, 100" : "",
  }));
  const charges: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  clients.forEach((c, i) => {
    if (c.status === "encerrado") return;
    for (let m = 1; m <= 12; m++) {
      const due = `${year}-${pad(m)}-${pad(Math.min(28, 5 + i * 2))}`;
      const cid = id(10000 + i * 100 + m);
      charges.push({ id: cid, client_id: c.id, description: "Mensalidade", amount: amounts[i] / 100, due_date: due, status: "pendente", revision: 1, recurrence: "mensal" });
      const lateClient = i === 1 && m >= curMonth - 2;
      const lateOnce = i === 4 && m === curMonth - 1;
      if (due < today && !lateClient && !lateOnce) payments.push({ id: id(20000 + i * 100 + m), charge_id: cid, amount: i === 2 && m === curMonth - 1 ? amounts[i] / 200 : amounts[i] / 100, paid_at: due });
    }
  });
  charges.push(
    { id: id(900), client_id: id(4), description: "Quinzenal", amount: 450, due_date: addDays(today, -4), status: "pendente", revision: 1, recurrence: "quinzenal" },
    { id: id(901), client_id: id(4), description: "Quinzenal", amount: 450, due_date: addDays(today, 10), status: "pendente", revision: 1, recurrence: "quinzenal" },
  );
  const receipt = {
    roster: [], rosterError: null, clients: clients.map((c) => ({ id: c.id, trade_name: c.trade_name, status: c.status })), charges, payments,
    schedules: [{ id: id(800), client_id: id(1), project_id: null, revision: 1, config: { description: "Mensalidade", amount: 180000, frequency: "mensal", start: `${year}-01-01`, end: `${year}-12-31`, day1: 5, day2: 20, method: "Pix" } }],
    projects: [], bank: [{ id: id(700), clientId: id(5), date: addDays(today, -3), amount: 150000 }], accounts: [{ id: id(600), name: "Conta PJ (demonstração)" }], audit: [], reconciliations: [],
  };
  const renewals = [120, 13, 24, 180, 21, 70];
  const health = ["saudavel", "em_risco", "atencao", null, "saudavel", "atencao", "saudavel", null];
  // Pós-venda: mesmas funções puras do servidor (parseManagement, clientFinance, healthScore, contractMrr).
  const csStage = ["acompanhamento", "renovacao", "acompanhamento", "implementacao", "acompanhamento", "onboarding", "novo", "encerrado"];
  const commercial = ["crescimento", "cancelamento", "revisar", null, "upsell", "inatividade", "saudavel", null];
  const crit = (v: number, why: string) => ({ value: v, reason: why, source: "Registro de exemplo (demonstração)", evaluatedAt: `${addDays(today, -5)}T12:00:00.000Z` });
  const critSets = [
    { satisfaction: crit(90, "Cliente elogiou os resultados na última reunião."), engagement: crit(85, "Responde rápido e participa das reuniões."), results: crit(80, "Metas do trimestre atingidas."), contract: crit(90, "Contrato vigente e renovado.") },
    { satisfaction: crit(35, "Reclamou do atraso nas entregas."), engagement: crit(40, "Sem resposta há 3 semanas."), results: crit(45, "Resultados abaixo do combinado."), contract: crit(50, "Renovação próxima sem conversa.") },
    { satisfaction: crit(65, "Satisfeito, mas pediu ajustes."), engagement: crit(60, "Participa de forma irregular."), results: crit(70, "Resultados estáveis.") },
    { satisfaction: crit(75, "Início positivo da implantação.") },
    { satisfaction: crit(88, "Pediu proposta de novos serviços."), engagement: crit(90, "Contato semanal."), results: crit(85, "Crescimento de vendas."), contract: crit(80, "Contrato anual.") },
    { engagement: crit(30, "Pausou o serviço."), results: crit(50, "Sem dados recentes.") },
    { satisfaction: crit(80, "Feedback positivo."), engagement: crit(75, "Bom relacionamento.") },
    {},
  ];
  const day = today;
  const cs = {
    today, revenueMonthly: {},
    clients: clients.map((c, i) => {
      const management = parseManagement({
        accountStatus: null, commercialStatus: commercial[i], nextFollowup: addDays(today, [3, -4, 7, 1, 10, -12, 5, 30][i]),
        contracts: i < 6 ? [{ id: id(500 + i), title: "Contrato de serviços", start: `${year}-02-01`, renewal: addDays(today, renewals[i]), termMonths: 12, amountCents: amounts[i], billing: "mensal", billingMonths: 1, status: i === 5 ? "pausado" : "ativo", responsible: c.internal_responsible, note: "" }] : [],
        criteria: critSets[i],
      });
      const own = charges.filter((x) => x.client_id === c.id).map((x) => ({ id: String(x.id), amount: Number(x.amount), due_date: String(x.due_date), status: String(x.status) }));
      const pays = payments.map((p) => ({ id: String(p.id), charge_id: String(p.charge_id), amount: Number(p.amount), paid_at: String(p.paid_at), confirmed_by: "Demonstração" }));
      const finance = clientFinance(own, pays, day);
      const criteria = { ...management.criteria, finance: finance.criterion ?? management.criteria.finance };
      const score = healthScore(criteria);
      const last = addDays(today, -[6, 25, 12, 2, 4, 40, 9, 90][i]);
      return {
        ...c, stage: csStage[i], health: health[i], revision: 0, last_followup_at: `${last}T12:00:00.000Z`, management,
        accountStatus: ({ ativo: "ativo", pausado: "pausado", encerrado: "encerrado", implantacao: "implementacao" } as Record<string, string>)[c.status] ?? "novo",
        finance, criteria, score, scores: [], lastContact: `${last}T12:00:00.000Z`, summary: i === 1 ? "Risco de cancelamento: atraso no pagamento e baixa resposta (exemplo)." : "Dados insuficientes para análise",
        suggestion: null, mrrCents: contractMrr(management.contracts, day), tasks: [], recoveryProgress: i === 1 ? 33 : null, history: [],
      };
    }),
  };
  const counts = { ativo: 5, implantacao: 1, pausado: 1, encerrado: 1 };
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${pad(i + 1)}`, revenueCents: i + 1 <= curMonth ? 700000 + i * 45000 + (i % 3) * 30000 : null, incomplete: i + 1 === curMonth, empty: i + 1 > curMonth }));
  const entry = (n: number, name: string, amount: number, due: string) => ({ id: id(n), kind: "entry", revision: 1, data: { name, amount, direction: "out", category: "administrativa", dueDate: due, competence: today.slice(0, 7), serviceMonths: 1, accountId: null, clientId: null, supplier: "", status: "pendente", note: "", recurrence: { frequency: "unica", interval: 1, count: 1 }, seriesKey: null, occurrence: 0, service: "", paymentMethod: "", contractStatus: "ativa" } });
  const snapshot = {
    records: [
      { id: id(300), kind: "account", revision: 1, data: { name: "Conta PJ (demonstração)", amount: 4200000, referenceDate: `${today.slice(0, 7)}-01`, conciliated: true, note: "" } },
      entry(310, "Ferramentas (exemplo)", 30000, addDays(today, -2)), entry(311, "Tráfego pago (exemplo)", 250000, addDays(today, 3)),
      entry(312, "Contabilidade (exemplo)", 90000, addDays(today, 5)), entry(313, "Aluguel (exemplo)", 320000, addDays(today, 21)),
      { id: id(320), kind: "goal", revision: 1, data: { name: "Reserva de emergência", amount: 3000000, dueDate: `${year + 1}-03-01`, priority: "alta", status: "ativa", position: 0, reserve: true, note: "" } },
    ],
    charges, payments, clients: clients.map((c) => ({ id: c.id, trade_name: c.trade_name })), audit: [], personalAllowed: false, personal: false,
  };
  const lead = (n: number, name: string, company: string, detail: string, at: string) => ({ id: id(n), name, company, stage: "novo", pipelineId: null, pipelineName: "Principal", detail, at });
  const todayData = { today, awaiting: [lead(1001, "Lead Exemplo", "Empresa A", "", `${today}T09:00:00-03:00`), lead(1002, "Lead Demo", "Empresa B", "", `${addDays(today, -1)}T15:00:00-03:00`)], returnsToday: [], overdue: [{ ...lead(1003, "Lead Teste", "Empresa C", "Retorno combinado", addDays(today, -2)), daysLate: 2 }], meetings: [] };
  const detail = (cid: string) => {
    const c = clients.find((x) => x.id === cid) ?? clients[0];
    const own = charges.filter((x) => x.client_id === c.id);
    return {
      client: c, knowledge: [], projects: [], plans: [], versions: [], documents: [],
      records: [{ id: id(1100), created_at: `${addDays(today, -4)}T14:00:00Z`, kind: "observacao", description: "Reunião de alinhamento mensal (exemplo)" }],
      tasks: [{ id: id(1200), created_at: `${addDays(today, -3)}T10:00:00Z`, title: "Enviar relatório mensal (exemplo)", status: "pendente", due_date: addDays(today, 3), priority: "alta" }],
      charges: own, payments: payments.filter((p) => own.some((x) => x.id === p.charge_id)), conversations: [], appointments: [],
      finance: { previsto: 0, pendente: 0, vencido: 0, recebido: 0 }, linkedInstagram: "", conversationKey: "", conversationInstance: "",
    };
  };
  // Funil (Pipeline) com leads fictícios distribuídos pelas etapas, para abrir os cards.
  const people = ["Mariana Alves", "Rafael Costa", "Juliana Rocha", "Pedro Lima", "Camila Souza", "Lucas Martins", "Beatriz Nunes", "Thiago Ramos", "Larissa Melo", "Gustavo Pires", "Fernanda Dias", "André Lopes", "Patrícia Gomes", "Diego Barros"];
  const companies = ["Clínica Sorriso Exemplo", "Academia Movimento Demo", "Padaria Pão Fictício", "Estética Bella Teste", "Odonto Prime Modelo", "Pet Amigo Ilustrativo", "Studio Fit Amostra", "Restaurante Sabor Demo", "Loja Moda Exemplo", "Imobiliária Casa Teste", "Escola Saber Modelo", "Ótica Visão Demo", "Barbearia Estilo Teste", "Café Aroma Fictício"];
  const stagesSeq = ["lead-novo", "lead-novo", "tentando-contato", "tentando-contato", "contato-realizado", "qualificacao", "qualificacao", "mql", "sql", "reuniao-agendada", "reuniao-agendada", "aguardando-decisao", "fechado", "perda"];
  const sources = ["Instagram", "Indicação", "Site", "Google Ads", "Meta Ads", "Instagram", "Site", "Indicação", "Meta Ads", "Google Ads", "Instagram", "Site", "Indicação", "Instagram"];
  const tagSeq = [["quente"], ["morno"], ["frio"], ["urgente", "quente"], ["alto-potencial"], ["morno"], [], ["quente"], ["alto-potencial"], ["reuniao-marcada"], ["reuniao-marcada", "quente"], ["morno"], ["cliente-fechado"], ["perdido"]];
  const leads = people.map((name, i) => ({
    id: id(3000 + i), pipelineId: null, name, company: companies[i], whatsapp: "", email: `contato${i + 1}@exemplo.invalid`, instagram: `@exemplo${i + 1}`, website: "",
    investedTraffic: i % 2 ? "Sim" : "Não", revenue: ["R$ 30 mil/mês", "R$ 80 mil/mês", "R$ 150 mil/mês"][i % 3], employees: ["1-10", "10-50", "50-100"][i % 3],
    source: sources[i], utmSource: i % 4 === 3 ? "google" : undefined, utmCampaign: i % 4 === 3 ? "campanha-exemplo" : undefined,
    service: ["Tráfego pago", "Social media", "Site + SEO", "CRM"][i % 4], potentialValue: [2500, 4800, 1800, 7200, 3500][i % 5], closedValue: stagesSeq[i] === "fechado" ? 4200 : null,
    owner: i % 2 ? "Responsável B" : "Responsável A", entryDate: addDays(today, -(i * 3 + 1)), nextAction: ["Ligar para apresentar proposta", "Enviar portfólio", "Confirmar reunião", "Follow-up por WhatsApp"][i % 4],
    nextActionDate: addDays(today, (i % 5) - 2), status: "Em andamento", stage: stagesSeq[i], tags: tagSeq[i], notes: i % 3 === 0 ? "Lead demonstrou interesse em começar no próximo mês (exemplo)." : "",
    lastConversation: "", nextSteps: "",
    history: [
      { id: id(4000 + i * 3), date: `${addDays(today, -(i + 1))}T14:20:00Z`, text: "Ligação realizada — cliente pediu proposta (exemplo)", kind: "ligacao", result: "atendeu", responsible: "Responsável A" },
      { id: id(4001 + i * 3), date: `${addDays(today, -(i * 3 + 1))}T10:00:00Z`, text: `Lead criado via ${sources[i]}`, kind: "criacao" },
    ],
  }));
  const handlers: Record<string, (body: string) => unknown> = {
    getDashboardGrowth: (body) => demoGrowth(body),
    // Prospecção B2B: configuração "pronta" e resultados fictícios de busca (sem Google, sem consultas pagas).
    getB2bOverview: () => ({
      enabled: true, googleKeyConfigured: true, googleReady: true, deskReady: false, datasets: [], googleDailyLimit: 50, deskDailyLimit: 20,
      termsUrl: "https://exemplo.invalid/termos", privacyUrl: "https://exemplo.invalid/privacidade", databaseReady: true,
      databaseChecks: B2B_TABLES.map((table) => ({ table, status: "ready" })), todayRequests: [], companies: [], drafts: [], suppressions: [], approaches: [],
    }),
    searchB2b: (body) => {
      const seg = /"segment":"([^"]+)"/.exec(body.replace(/\\"/g, '"'))?.[1] ?? "Clínica odontológica";
      const city = /"city":"([^"]+)"/.exec(body.replace(/\\"/g, '"'))?.[1] ?? "Florianópolis";
      const names = ["Sorriso", "Bem Estar", "Vida Plena", "Central", "Prime", "Excelência", "Nova Era", "Saúde Total", "Família", "Premium", "Integrada", "Moderna"];
      return { places: names.map((n, i) => ({ id: `demo_place_${i + 1}`, name: `${seg} ${n} (exemplo)`, address: `Rua Fictícia, ${100 + i * 7} — ${city}`, phone: i % 3 === 2 ? "" : `+55489990000${String(10 + i)}`,
        website: i % 2 ? `https://exemplo${i + 1}.invalid` : "", category: seg, mapsUrl: "https://exemplo.invalid/mapa", rating: i % 4 === 3 ? null : Math.round((3.8 + (i % 6) * 0.2) * 10) / 10,
        userRatingCount: i % 4 === 3 ? null : 12 + i * 9, instagram: i % 3 === 0 ? `@exemplo_${i + 1}` : "", attributions: [] })), cursor: null };
    },
    listCrmLeads: () => leads, listPipelines: () => [], getCrmZapierSetting: () => "", listLeadClientLinks: () => ({ links: [] }),
    getReceiptControl: () => receipt, listClients: () => ({ clients, counts }), getCsOverview: () => cs, getClientCardLinks: () => ({ links: [] }),
    getCrmAccess: () => ({ full: true }), getFinance: () => ({ months: [], traffic: [], updatedAt: null, error: null, needsAuth: false }),
    getFinanceManagement: () => snapshot,
    getFaturamentoAnual: () => ({ stats: { accumulated: months.reduce((n, m) => n + (m.revenueCents ?? 0), 0), best: { month: months[Math.max(0, curMonth - 2)].month, amount: months[Math.max(0, curMonth - 2)].revenueCents }, average: 950000, elapsedMonths: curMonth }, months }),
    getDashboardToday: () => ({ needsAuth: false, data: todayData }), projectsAllowed: () => ({ allowed: true }),
    getClient: (body) => detail((/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(body) ?? [""])[0]),
  };
  return handlers;
}

function exportName(url: string) {
  try {
    const raw = url.split("/_serverFn/")[1]?.split("?")[0] ?? "";
    const json = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    return String(JSON.parse(json).export ?? "").replace(/_createServerFn_handler$/, "");
  } catch { return ""; }
}

/** Crescimento e unit economics: as MESMAS funções de cálculo do sistema, alimentadas com uma carteira fictícia. */
function demoGrowth(body: string) {
  const today = todayISO();
  const range = /"from":"(\d{4}-\d{2}-\d{2})","to":"(\d{4}-\d{2}-\d{2})"/.exec(body.replace(/\\"/g, '"')) ?? [];
  const from = range[1] ?? addDays(today, -365), to = range[2] ?? today;
  const monthStart = (back: number) => { const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - back); return d.toISOString().slice(0, 10); };
  const amounts = [180000, 120000, 250000, 90000, 150000, 80000, 110000, 210000, 95000, 130000];
  const joinBack = [14, 13, 12, 10, 9, 7, 6, 4, 3, 1];
  const contract = (i: number, start: string, status = "ativo") => ({ id: id(7000 + i), title: "Serviço recorrente", start, renewal: null, termMonths: null, amountCents: amounts[i], billing: "mensal", billingMonths: 1, status, responsible: "", note: "" });
  const clients: GrowthClient[] = amounts.map((_, i) => ({ id: id(6000 + i), status: i === 5 ? "encerrado" : "ativo", created_at: `${monthStart(joinBack[i])}T12:00:00Z`, updated_at: `${today}T12:00:00Z`,
    management: { contracts: [contract(i, monthStart(joinBack[i]), i === 5 ? "cancelado" : "ativo")] } }));
  const history: GrowthHistory[] = [];
  amounts.forEach((_, i) => {
    for (let back = joinBack[i]; back >= 0; back--) {
      const cancelled = i === 5 && back <= 2;
      history.push({ id: id(8000 + i * 20 + back), client_id: id(6000 + i), created_at: `${monthStart(back)}T12:00:00Z`, before_state: null,
        after_state: { management: { contracts: [contract(i, monthStart(joinBack[i]), cancelled ? "cancelado" : "ativo")], ...(cancelled ? { accountStatus: "encerrado" } : {}) } } });
    }
  });
  const result = growthMetrics(clients, history, from, to, today);
  const rows: OverviewRow[] = [];
  const receipts: { amountCents: number; date: string }[] = [];
  for (let back = 13; back >= 0; back--) {
    const m = monthStart(back);
    const active = amounts.filter((_, i) => joinBack[i] >= back && !(i === 5 && back <= 2));
    receipts.push({ amountCents: active.reduce((n, a) => n + a, 0), date: addDays(m, 9) });
    const exp = (n: number, cat: string, cents: number) => rows.push({ transactionId: id(9000 + back * 10 + n), transactionAt: `${addDays(m, 12 + n)}T12:00:00Z`, amountCents: -cents, currency: "BRL", direction: "DEBITO", description: cat, counterparty: null, cls: { kind: "despesa_operacional", category: cat as never, vendor: null, source: "manual" as never }, status: "confirmado", reconciled: false });
    exp(1, "publicidade_marketing", 180000 + back * 4000); exp(2, "fornecedores", 220000); exp(3, "impostos", 90000 + (13 - back) * 3000); exp(4, "softwares_assinaturas", 75000);
  }
  const sales = amounts.map((_, i) => ({ customerKey: id(6000 + i), saleType: "nova", firstAcquisition: true, closedOn: monthStart(joinBack[i]) }));
  const unit = unitEconomics({ rows, receipts, from, to, sales, pendingSales: () => 0, arpa: result.metrics.ticket.value, churnPct: result.metrics.churn.value });
  const names = ["Clínica Exemplo", "Padaria Modelo", "Academia Demo", "Odonto Teste", "Loja Fictícia", "Estúdio Amostra", "Pet Shop Ilustrativo", "Imobiliária Teste", "Café Demo", "Escola Modelo"];
  return { needsAuth: false, data: { ...result, topClients: result.topClients.map((t) => ({ ...t, name: names[Number(t.id.slice(-2)) % 10] ?? "Cliente" })), unit } };
}

/** Instala o interceptador de funções de servidor no navegador (somente com VITE_UX_DEMO=1). */
export function installUxDemo() {
  if (typeof window === "undefined" || (window as { __pipeflowUxDemo?: boolean }).__pipeflowUxDemo) return;
  (window as { __pipeflowUxDemo?: boolean }).__pipeflowUxDemo = true;
  const handlers = buildData();
  // No modo demonstração o portão do Pipeline já abre com acesso completo (dados fictícios).
  try { window.sessionStorage.setItem("crm-access-level", "full"); } catch { /* sem armazenamento */ }
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/_serverFn/")) return original(input, init);
    const name = exportName(url);
    const handler = handlers[name];
    if (!handler) return new Response(`Modo demonstração: "${name || "operação"}" indisponível (sem banco e sem gravações).`, { status: 500, headers: { "content-type": "text/plain" } });
    const body = decodeURIComponent(url) + (typeof init?.body === "string" ? init.body : "");
    return new Response(JSON.stringify({ result: handler(body) }), { status: 200, headers: { "content-type": "application/json" } });
  };
}
