export type Stage = { id: string; title: string };

export const DEFAULT_STAGES: Stage[] = [
  { id: "lead-novo", title: "Lead Novo" },
  { id: "tentando-contato", title: "Tentando Contato" },
  { id: "contato-realizado", title: "Contato Realizado" },
  { id: "retornar-mais-tarde", title: "Retornar Mais Tarde" },
  { id: "primeira-ligacao", title: "Primeira Ligação" },
  { id: "segunda-ligacao", title: "Segunda Ligação" },
  { id: "terceira-ligacao", title: "Terceira Ligação" },
  { id: "qualificacao", title: "Qualificação" },
  { id: "mql", title: "MQL" },
  { id: "sql", title: "SQL" },
  { id: "reuniao-agendada", title: "Reunião Agendada" },
  { id: "aguardando-decisao", title: "Aguardando Decisão" },
  { id: "fechado", title: "Fechado" },
  { id: "perda", title: "Perda" },
];

export const STAGES = DEFAULT_STAGES;

export type StageId = string;

export type Tag = { id: string; label: string; color: string };

export const DEFAULT_TAGS: Tag[] = [
  { id: "quente", label: "Quente", color: "oklch(0.65 0.22 25)" },
  { id: "morno", label: "Morno", color: "oklch(0.78 0.15 70)" },
  { id: "frio", label: "Frio", color: "oklch(0.65 0.13 230)" },
  { id: "urgente", label: "Urgente", color: "oklch(0.6 0.25 15)" },
  { id: "alto-potencial", label: "Alto potencial", color: "oklch(0.78 0.13 85)" },
  { id: "baixo-orcamento", label: "Baixo orçamento", color: "oklch(0.6 0.05 250)" },
  { id: "retornar-depois", label: "Retornar depois", color: "oklch(0.65 0.1 290)" },
  { id: "reuniao-marcada", label: "Reunião marcada", color: "oklch(0.6 0.18 200)" },
  { id: "cliente-fechado", label: "Cliente fechado", color: "oklch(0.65 0.16 155)" },
  { id: "perdido", label: "Perdido", color: "oklch(0.5 0.04 260)" },
  { id: "nao-atendeu", label: "Não atendeu", color: "oklch(0.6 0.12 50)" },
];

export const TAG_OPTIONS: Tag[] = DEFAULT_TAGS;

export type TagId = string;

export type HistoryEntry = {
  id: string;
  date: string;
  text: string;
  kind?: string;
  source?: string;
  result?: string;
  direction?: string;
  note?: string;
  responsible?: string;
  /** Cliente cadastrado vinculado (eventos de criação/vínculo de card). */
  client?: string;
};

export type Lead = {
  id: string;
  pipelineId?: string | null;
  name: string;
  company: string;
  whatsapp: string;
  email: string;
  instagram: string;
  website: string;
  investedTraffic: string;
  revenue: string;
  employees: string;
  source: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  service: string;
  potentialValue: number;
  /** Valor fechado confirmado na etapa Fechado (null = ainda não confirmado). Gravado só por confirmLeadClosedValue. */
  closedValue?: number | null;
  closedValueConfirmedAt?: string | null;
  owner: string;
  entryDate: string;
  nextAction: string;
  nextActionDate: string;
  status: string;
  stage: StageId;
  tags: TagId[];
  notes: string;
  lastConversation: string;
  nextSteps: string;
  history: HistoryEntry[];
};

export const SOURCES = [
  "Indicação",
  "Site",
  "Instagram",
  "LinkedIn",
  "Google Ads",
  "Evento",
  "Outbound",
  "Outro",
];

export const OWNERS = ["Ana Souza", "Bruno Lima", "Carla Mendes", "Diego Alves"];

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function seedLeads(): Lead[] {
  const today = new Date().toISOString().slice(0, 10);
  return ([
    {
      id: newId(),
      name: "Marcos Pereira",
      company: "Acme Tech",
      whatsapp: "+55 11 99999-1234",
      email: "marcos@acme.com",
      source: "Site",
      service: "Consultoria de Vendas",
      potentialValue: 24000,
      owner: "Ana Souza",
      entryDate: today,
      nextAction: "Enviar proposta",
      nextActionDate: today,
      status: "Aguardando proposta",
      stage: "qualificacao",
      tags: ["quente", "alto-potencial"],
      notes: "Decisor identificado. Já viu demo.",
      lastConversation: "Reunião exploratória realizada.",
      nextSteps: "Enviar proposta comercial detalhada.",
      history: [
        { id: newId(), date: today, text: "Lead criado a partir do site." },
      ],
    },
    {
      id: newId(),
      name: "Juliana Castro",
      company: "Bright Studio",
      whatsapp: "+55 21 98888-5678",
      email: "ju@bright.com",
      source: "Instagram",
      service: "Branding",
      potentialValue: 8500,
      owner: "Bruno Lima",
      entryDate: today,
      nextAction: "Ligar",
      nextActionDate: today,
      status: "Contato inicial",
      stage: "tentando-contato",
      tags: ["morno"],
      notes: "",
      lastConversation: "Mensagem enviada via WhatsApp.",
      nextSteps: "Follow-up em 2 dias.",
      history: [],
    },
    {
      id: newId(),
      name: "Felipe Andrade",
      company: "NorthOne",
      whatsapp: "+55 31 97777-3322",
      email: "felipe@northone.com",
      source: "LinkedIn",
      service: "Implantação CRM",
      potentialValue: 56000,
      owner: "Carla Mendes",
      entryDate: today,
      nextAction: "Reunião",
      nextActionDate: today,
      status: "Reunião confirmada",
      stage: "reuniao-agendada",
      tags: ["alto-potencial", "reuniao-marcada"],
      notes: "CTO presente na call.",
      lastConversation: "Agenda fechada para quinta.",
      nextSteps: "Preparar deck personalizado.",
      history: [],
    },
    {
      id: newId(),
      name: "Renata Lopes",
      company: "Lopes & Cia",
      whatsapp: "+55 11 96666-1010",
      email: "renata@lopes.com",
      source: "Indicação",
      service: "Treinamento",
      potentialValue: 12000,
      owner: "Ana Souza",
      entryDate: today,
      nextAction: "Aguardar retorno",
      nextActionDate: today,
      status: "Em análise interna",
      stage: "aguardando-decisao",
      tags: ["quente"],
      notes: "",
      lastConversation: "Proposta apresentada à diretoria.",
      nextSteps: "Aguardar decisão até sexta.",
      history: [],
    },
    {
      id: newId(),
      name: "Thiago Nogueira",
      company: "Verdana",
      whatsapp: "+55 41 95555-2020",
      email: "thiago@verdana.com",
      source: "Google Ads",
      service: "Consultoria",
      potentialValue: 18000,
      owner: "Diego Alves",
      entryDate: today,
      nextAction: "Onboarding",
      nextActionDate: today,
      status: "Contrato assinado",
      stage: "fechado",
      tags: ["cliente-fechado"],
      notes: "",
      lastConversation: "Contrato assinado digitalmente.",
      nextSteps: "Iniciar onboarding semana que vem.",
      history: [],
    },
    {
      id: newId(),
      name: "Patrícia Gomes",
      company: "Gomes Imports",
      whatsapp: "+55 51 94444-7878",
      email: "patricia@gomes.com",
      source: "Outbound",
      service: "Consultoria",
      potentialValue: 6000,
      owner: "Bruno Lima",
      entryDate: today,
      nextAction: "—",
      nextActionDate: today,
      status: "Sem fit",
      stage: "perda",
      tags: ["perdido", "baixo-orcamento"],
      notes: "Orçamento muito baixo.",
      lastConversation: "Cliente desistiu do projeto.",
      nextSteps: "Retomar em 6 meses.",
      history: [],
    },
    {
      id: newId(),
      name: "Lucas Martins",
      company: "Martins SA",
      whatsapp: "+55 11 93333-1212",
      email: "lucas@martins.com",
      source: "Site",
      service: "Implantação",
      potentialValue: 32000,
      owner: "Carla Mendes",
      entryDate: today,
      nextAction: "Qualificar",
      nextActionDate: today,
      status: "Novo",
      stage: "lead-novo",
      tags: ["urgente"],
      notes: "",
      lastConversation: "",
      nextSteps: "Primeiro contato.",
      history: [],
    },
  ] as Omit<Lead, "instagram" | "revenue" | "employees" | "website" | "investedTraffic">[]).map((l) => ({ ...l, instagram: "", revenue: "", employees: "", website: "", investedTraffic: "" }));
}
