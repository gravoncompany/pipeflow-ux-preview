// MODO DEMONSTRAÇÃO (somente versão experimental pipeflow-ux-preview).
// Ativado apenas com VITE_UX_DEMO=1. Responde às funções de servidor no próprio navegador com
// dados FICTÍCIOS, para visualizar a interface sem banco de dados. Nenhum dado real, nenhuma
// gravação e nenhum envio: qualquer operação de escrita retorna erro de "modo demonstração".

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
  const cs = {
    today, revenueMonthly: [],
    clients: clients.map((c, i) => ({ ...c, health: health[i], mrrCents: amounts[i], management: { contracts: i < 6 ? [{ id: id(500 + i), title: "Contrato", renewal: addDays(today, renewals[i]), status: "ativo", amountCents: amounts[i] }] : [] }, finance: { overdueCents: 0 } })),
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
  const todayData = { today, awaiting: [lead(1001, "Lead Exemplo", "Empresa A", "", `${today}T09:00:00-03:00`), lead(1002, "Lead Demo", "Empresa B", "", `${addDays(today, -1)}T15:00:00-03:00`)], returnsToday: [], overdue: [lead(1003, "Lead Teste", "Empresa C", "Retorno combinado", `${addDays(today, -2)}T10:00:00-03:00`)], meetings: [] };
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
  const handlers: Record<string, (body: string) => unknown> = {
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

/** Instala o interceptador de funções de servidor no navegador (somente com VITE_UX_DEMO=1). */
export function installUxDemo() {
  if (typeof window === "undefined" || (window as { __pipeflowUxDemo?: boolean }).__pipeflowUxDemo) return;
  (window as { __pipeflowUxDemo?: boolean }).__pipeflowUxDemo = true;
  const handlers = buildData();
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
