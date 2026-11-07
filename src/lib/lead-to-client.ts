import type { Lead } from "./crm-types";

export type LeadClientDraft = {
  id: null; leadId: string; tradeName: string; legalName: string; cnpj: string; contactName: string; phone: string;
  whatsapp: string; email: string; address: string; website: string; relationshipStart: string | null; servicesText: string;
  status: string; internalResponsible: string; reminderDays: number; notes: string; revision: number;
};

const today = () => new Date().toISOString().slice(0, 10);

/** Cadastro de cliente pré-preenchido com os dados do card: empresa vira o título, a pessoa vira o contato responsável. */
export function leadToClientDraft(lead: Pick<Lead, "id" | "name" | "company" | "whatsapp" | "email" | "website" | "service">): LeadClientDraft {
  return {
    id: null, leadId: lead.id, tradeName: (lead.company ?? "").trim(), legalName: "", cnpj: "",
    contactName: (lead.name ?? "").trim(), phone: "", whatsapp: (lead.whatsapp ?? "").trim(), email: (lead.email ?? "").trim(),
    address: "", website: (lead.website ?? "").trim(), relationshipStart: today(), servicesText: (lead.service ?? "").trim(),
    status: "implantacao", internalResponsible: "", reminderDays: 5, notes: "", revision: 0,
  };
}

/** Motivos que impedem salvar sem revisão (mesmas regras do cadastro de clientes). */
export function clientDraftIssues(d: Pick<LeadClientDraft, "tradeName" | "cnpj">): string[] {
  const issues: string[] = [];
  if (d.tradeName.trim().length < 2) issues.push("Informe o nome da empresa.");
  if (d.cnpj && !/^\d{14}$/.test(d.cnpj)) issues.push("CNPJ deve ter 14 dígitos.");
  return issues;
}

export type CompanyPrefill = { legalName: string; cnpj: string; phone: string; address: string; email: string; website: string; tradeName: string };
/** Completa o cadastro com os dados da empresa já conhecidos (Prospecção B2B); nunca troca o que já veio preenchido. */
export function withCompanyData(d: LeadClientDraft, pre: CompanyPrefill | undefined, responsible = ""): LeadClientDraft {
  const fill = (cur: string, v: string | undefined) => cur.trim() ? cur : (v ?? "").trim();
  return {
    ...d,
    tradeName: fill(d.tradeName, pre?.tradeName || pre?.legalName),
    legalName: fill(d.legalName, pre?.legalName),
    cnpj: fill(d.cnpj, pre?.cnpj && /^\d{14}$/.test(pre.cnpj) ? pre.cnpj : ""),
    phone: fill(d.phone, pre?.phone),
    address: fill(d.address, pre?.address),
    email: fill(d.email, pre?.email),
    website: fill(d.website, pre?.website),
    internalResponsible: fill(d.internalResponsible, responsible),
  };
}
