import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  getCommercialKnowledge,
  saveCommercialKnowledge,
} from "@/lib/commercial-knowledge.functions";
import type { CommercialKnowledgeRecord } from "@/lib/commercial-knowledge";

export function CommercialKnowledgeEditor() {
  const list = useServerFn(getCommercialKnowledge);
  const save = useServerFn(saveCommercialKnowledge);
  const q = useQuery({
    queryKey: ["commercial-knowledge"],
    queryFn: () => list(),
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });
  const [editing, setEditing] = useState<CommercialKnowledgeRecord | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = (row: CommercialKnowledgeRecord | "new") => {
    setEditing(row);
    setTitle(row === "new" ? "" : row.title);
    setContent(row === "new" ? "" : row.text);
    setError(null);
  };
  async function submit() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await save({
        data: {
          event: crypto.randomUUID(),
          id: editing === "new" ? null : editing.id,
          revision: editing === "new" ? null : editing.revision,
          title,
          content,
        },
      });
      setEditing(null);
      await q.refetch();
    } catch {
      setError(
        "Não salvei. Confira sua conta administrativa ou recarregue o registro antes de tentar novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 border-t py-5" aria-label="Registros comerciais">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Registros comerciais</h2>
        <Button variant="outline" disabled={!q.data?.authorized} onClick={() => open("new")}>
          <Plus />
          Novo registro
        </Button>
      </div>
      {q.isError && (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os registros.
        </p>
      )}
      {q.data && !q.data.authorized && (
        <p className="text-sm text-muted-foreground">
          Entre com sua conta administrativa no Acesso individual para consultar e salvar registros
          comerciais.
        </p>
      )}
      {editing && (
        <form
          className="space-y-3 border-y py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor="knowledge-title">Título</Label>
          <Input
            id="knowledge-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            required
          />
          <Label htmlFor="knowledge-content">Conteúdo</Label>
          <Textarea
            id="knowledge-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={8000}
            rows={8}
            className="max-h-80 min-h-40 resize-y overflow-y-auto [field-sizing:fixed]"
            required
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              <Save />
              {busy ? "Salvando…" : "Salvar registro"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {q.data?.authorized && q.data.records.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum registro comercial cadastrado.</p>
      )}
      <ul className="space-y-3">
        {q.data?.records.map((row) => (
          <li key={row.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold">{row.title}</h3>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Editar ${row.title}`}
                title="Editar registro"
                onClick={() => open(row)}
              >
                <Pencil />
              </Button>
            </div>
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-sm">{row.text}</p>
            <p className="mt-3 break-all text-xs text-muted-foreground">
              Empresa: {row.company_key === "crm:1" ? "Gravon Company" : row.company_key} · Origem:{" "}
              {row.origin === "internal_chat"
                ? "Chat interno"
                : row.origin === "whatsapp"
                  ? "WhatsApp"
                  : "Menu"}{" "}
              · Autor: {row.author_id ?? "Não cadastrado"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Criado:{" "}
              {new Date(row.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}{" "}
              · Atualizado:{" "}
              {new Date(row.updated_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
            </p>
          </li>
        ))}
      </ul>
      {q.data?.hasMore && (
        <p className="text-xs text-muted-foreground">Exibindo os 20 registros mais recentes.</p>
      )}
    </section>
  );
}
