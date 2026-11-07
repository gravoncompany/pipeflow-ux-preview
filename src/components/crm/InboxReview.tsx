import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, EyeOff, Link2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveEmailInbox } from "@/lib/email-flows.functions";

type Row = { id: string; from_address: string; from_name: string; to_address: string; subject: string; body: string; received_at: string; unread: boolean; match: string };
type LeadOpt = { id: string; name: string; company: string; email: string };
type PipelineOpt = { id: string; name: string };
const fmt = (v: string) => new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/** E-mails de remetentes sem card: a pessoa decide criar um lead, vincular a um card existente ou ignorar. */
export function InboxReview({ rows, leads, pipelines, onDone }: { rows: Row[]; leads: LeadOpt[]; pipelines: PipelineOpt[]; onDone: (text: string) => void }) {
  if (!rows.length) return null;
  return <section className="space-y-3">
    <h2 className="text-lg font-semibold">E-mails de remetentes sem card ({rows.length})</h2>
    <p className="text-sm text-muted-foreground">Recebidos em contato@ de quem ainda não tem card. Nada vira lead sem a sua revisão.</p>
    <ul className="divide-y rounded-lg border">{rows.map((r) => <ReviewItem key={r.id} row={r} leads={leads} pipelines={pipelines} onDone={onDone} />)}</ul>
  </section>;
}

function ReviewItem({ row, leads, pipelines, onDone }: { row: Row; leads: LeadOpt[]; pipelines: PipelineOpt[]; onDone: (t: string) => void }) {
  const resolve = useServerFn(resolveEmailInbox);
  const [open, setOpen] = useState(false), [mode, setMode] = useState<"create" | "link" | null>(null);
  const [name, setName] = useState(row.from_name), [company, setCompany] = useState(""), [pipeline, setPipeline] = useState(pipelines[0]?.id ?? "main");
  const [search, setSearch] = useState(""), [leadId, setLeadId] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const matches = search.trim().length >= 2 ? leads.filter((l) => `${l.name} ${l.company} ${l.email}`.toLowerCase().includes(search.toLowerCase())).slice(0, 8) : [];
  async function go(action: "ignore" | "link" | "create") {
    setBusy(true); setErr("");
    try {
      await resolve({ data: { id: row.id, action, leadId: action === "link" ? leadId : null, pipelineId: action === "create" && pipeline !== "main" ? pipeline : null, name: action === "create" ? name : "", company: action === "create" ? company : "" } });
      onDone(action === "ignore" ? "E-mail ignorado; nenhum card criado." : action === "link" ? "E-mail vinculado ao card." : "Lead criado no primeiro estágio do funil escolhido.");
    } catch (e) { setErr(e instanceof Error ? e.message : "Não foi possível concluir."); }
    finally { setBusy(false); }
  }
  return <li className="space-y-2 p-3 text-sm">
    <button type="button" className="flex w-full items-start gap-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
      <span className="min-w-0 flex-1"><span className={`block truncate ${row.unread ? "font-semibold" : "font-medium"}`}>{row.subject || "(sem assunto)"}</span>
        <span className="block break-words text-xs text-muted-foreground">De {row.from_name ? `${row.from_name} <${row.from_address}>` : row.from_address} · {fmt(row.received_at)}{row.unread ? " · não lido" : ""}{row.match === "ambiguous" ? " · mais de um card com este e-mail" : ""}</span></span>
    </button>
    {open && <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 font-sans text-sm">{row.body || "(sem texto)"}</pre>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant={mode === "create" ? "default" : "outline"} onClick={() => setMode(mode === "create" ? null : "create")}><UserPlus className="size-4" />Criar lead</Button>
      <Button size="sm" variant={mode === "link" ? "default" : "outline"} onClick={() => setMode(mode === "link" ? null : "link")}><Link2 className="size-4" />Vincular a um card</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void go("ignore")}><EyeOff className="size-4" />Ignorar</Button>
    </div>
    {mode === "create" && <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-3">
      <Input aria-label="Nome do contato" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
      <Input aria-label="Empresa" placeholder="Empresa (opcional)" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={150} />
      <select aria-label="Funil" className="h-9 rounded-md border bg-background px-2 text-sm" value={pipeline} onChange={(e) => setPipeline(e.target.value)}>
        <option value="main">Funil principal</option>{pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Button size="sm" className="sm:col-span-3 sm:w-fit" disabled={busy || !name.trim()} onClick={() => void go("create")}>Confirmar e criar lead com {row.from_address}</Button>
    </div>}
    {mode === "link" && <div className="space-y-2 rounded-md border p-3">
      <Input aria-label="Buscar card" placeholder="Buscar nome, empresa ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} />
      {matches.map((l) => <label key={l.id} className="flex items-center gap-2"><input type="radio" name={`link-${row.id}`} checked={leadId === l.id} onChange={() => setLeadId(l.id)} />{l.name || "Sem nome"}{l.company ? ` · ${l.company}` : ""} <span className="text-xs text-muted-foreground">{l.email}</span></label>)}
      <Button size="sm" disabled={busy || !leadId} onClick={() => void go("link")}>Vincular</Button>
    </div>}
    {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
  </li>;
}
