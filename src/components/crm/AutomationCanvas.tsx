import "@xyflow/react/dist/style.css";
import { useCallback, useMemo } from "react";
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import { BellRing, ClipboardCheck, Clock, Mail, MessageSquareReply, PencilLine, Sparkles, Square, Zap } from "lucide-react";
import { NODE_LABEL, type AutomationGraph, type GraphNode } from "@/lib/automations";
import { cn } from "@/lib/utils";

export const NODE_ICON = { trigger: Zap, ai: Sparkles, email: Mail, wait: Clock, if_reply: MessageSquareReply, if_form: ClipboardCheck, update_card: PencilLine, notify: BellRing, end: Square } as const;

type Ctx = { stageTitle: (id: string) => string; pipelineName: (id: string | null) => string; emailIndex: Map<string, number> };
type BlockData = { node: GraphNode; ctx: Ctx };

export function nodeSummary(n: GraphNode, ctx: Ctx) {
  switch (n.kind) {
    case "trigger": return `${n.data.mode === "manual" ? "Início manual — Cards selecionados" : "Card adicionado"} · ${ctx.pipelineName(n.data.pipelineId)}`;
    case "ai": return "Personaliza o próximo e-mail";
    case "email": return `${ctx.emailIndex.get(n.id) ?? "?"}º e-mail · ${n.data.subject || "sem assunto"}`;
    case "wait": return `${n.data.amount} ${n.data.unit === "days" ? (n.data.amount === 1 ? "dia" : "dias") : (n.data.amount === 1 ? "hora" : "horas")}`;
    case "if_reply": return "Por e-mail ou WhatsApp";
    case "if_form": return "Diagnóstico estratégico";
    case "update_card": {
      const p = [n.data.stage && `Etapa: ${ctx.stageTitle(n.data.stage)}`, n.data.tag && `Etiqueta: ${n.data.tag}`, n.data.status && `Status: ${n.data.status}`].filter(Boolean);
      return p.length ? p.join(" · ") : "Nenhuma alteração definida";
    }
    case "notify": return `Aviso por ${n.data.channel === "push" ? "notificação no app" : n.data.channel === "email" ? "e-mail" : "WhatsApp"}`;
    case "end": return "Fim deste caminho";
  }
}

function Block({ data, selected }: NodeProps<Node<BlockData>>) {
  const n = data.node;
  const Icon = NODE_ICON[n.kind];
  const cond = n.kind === "if_reply" || n.kind === "if_form";
  return (
    <div className={cn("w-60 rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm",
      selected ? "border-primary ring-2 ring-primary/30" : "border-border",
      n.kind === "trigger" && "border-primary/60 bg-primary/5")}>
      {n.kind !== "trigger" && <Handle type="target" position={Position.Top} className="!size-2.5 !bg-primary" />}
      <div className="flex items-center gap-2">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", cond ? "bg-accent text-accent-foreground" : "bg-primary/10 text-primary")}><Icon className="size-4" /></span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold">{NODE_LABEL[n.kind]}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{nodeSummary(n, data.ctx)}</span>
        </span>
      </div>
      {cond ? (
        <>
          <Handle id="yes" type="source" position={Position.Right} className="!size-2.5 !bg-primary" />
          <Handle id="no" type="source" position={Position.Bottom} className="!size-2.5 !bg-muted-foreground" />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>↓ Não</span><span>Sim →</span></div>
        </>
      ) : n.kind !== "end" && <Handle type="source" position={Position.Bottom} className="!size-2.5 !bg-primary" />}
    </div>
  );
}

const nodeTypes = { block: Block };

export function AutomationCanvas({ graph, onChange, selectedId, onSelect, ctx, readOnly }: {
  graph: AutomationGraph; onChange: (g: AutomationGraph) => void; selectedId: string | null; onSelect: (id: string | null) => void; ctx: Ctx; readOnly: boolean;
}) {
  const nodes = useMemo<Node<BlockData>[]>(() => graph.nodes.map((n) => ({
    id: n.id, type: "block", position: { x: n.x, y: n.y }, data: { node: n, ctx }, selected: n.id === selectedId, deletable: !readOnly && n.kind !== "trigger",
  })), [graph.nodes, ctx, selectedId, readOnly]);
  const edges = useMemo<Edge[]>(() => graph.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, sourceHandle: e.branch ?? undefined, deletable: !readOnly,
    label: e.branch === "yes" ? "Sim" : e.branch === "no" ? "Não" : undefined,
    markerEnd: { type: MarkerType.ArrowClosed }, labelBgPadding: [4, 2] as [number, number],
  })), [graph.edges, readOnly]);

  const onNodesChange = useCallback((changes: NodeChange<Node<BlockData>>[]) => {
    let next = graph, touched = false;
    for (const c of changes) {
      if (c.type === "select") { if (c.selected) onSelect(c.id); else if (selectedId === c.id) onSelect(null); }
      if (readOnly) continue;
      if (c.type === "position" && c.position) {
        next = { ...next, nodes: next.nodes.map((n) => (n.id === c.id ? { ...n, x: Math.round(c.position!.x), y: Math.round(c.position!.y) } : n)) }; touched = true;
      }
      if (c.type === "remove") {
        const node = next.nodes.find((n) => n.id === c.id);
        if (!node || node.kind === "trigger") continue;
        next = { nodes: next.nodes.filter((n) => n.id !== c.id), edges: next.edges.filter((e) => e.source !== c.id && e.target !== c.id) }; touched = true;
      }
    }
    if (touched) onChange(next);
  }, [graph, onChange, onSelect, selectedId, readOnly]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (readOnly) return;
    const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => c.id));
    if (removed.size) onChange({ ...graph, edges: graph.edges.filter((e) => !removed.has(e.id)) });
  }, [graph, onChange, readOnly]);

  const onConnect = useCallback((c: Connection) => {
    if (readOnly || !c.source || !c.target || c.source === c.target) return;
    const branch = c.sourceHandle === "yes" || c.sourceHandle === "no" ? c.sourceHandle : null;
    // Cada saída leva a um único bloco: a nova ligação substitui a anterior.
    const edges = graph.edges.filter((e) => !(e.source === c.source && e.branch === branch));
    onChange({ ...graph, edges: [...edges, { id: `${c.source}-${branch ?? "o"}-${c.target}`.slice(0, 90), source: c.source, target: c.target, branch }] });
  }, [graph, onChange, readOnly]);

  return (
    <div className="h-[640px] w-full overflow-hidden rounded-lg border bg-muted/30" aria-label="Desenho da automação">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
        onPaneClick={() => onSelect(null)}
        nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
        defaultViewport={{ x: 40, y: 20, zoom: 0.9 }} minZoom={0.3} maxZoom={1.5} proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
