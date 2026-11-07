import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { classifySale, getSaleReview } from "@/lib/sale-classifications.functions";
import {
  SALE_TYPES,
  saleTypeLabel,
  type ClosingRow,
  type SaleType,
} from "@/lib/sale-classifications";
import { currency } from "@/lib/revenue";

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}/${m}/${y}` : iso;
};

type Conflict = { priorClosedOn: string; priorLeadName: string } | null;

function SaleTypeFields({
  saleType,
  setSaleType,
  closedOn,
  setClosedOn,
  by,
  setBy,
}: {
  saleType: SaleType | "";
  setSaleType: (v: SaleType) => void;
  closedOn: string;
  setClosedOn: (v: string) => void;
  by: string;
  setBy: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Tipo de venda
        </Label>
        <Select value={saleType} onValueChange={(v) => setSaleType(v as SaleType)}>
          <SelectTrigger aria-label="Tipo de venda">
            <SelectValue placeholder="Selecione o tipo de venda" />
          </SelectTrigger>
          <SelectContent>
            {SALE_TYPES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Data de fechamento
        </Label>
        <Input
          type="date"
          value={closedOn}
          max={todayISO()}
          onChange={(e) => setClosedOn(e.target.value)}
        />
      </div>
      <div>
        <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Classificado por
        </Label>
        <Input
          value={by}
          maxLength={80}
          placeholder="Seu nome"
          onChange={(e) => setBy(e.target.value)}
        />
      </div>
    </div>
  );
}

/** Mandatory classification prompt shown right after an opportunity is marked as closed. */
export function SaleCloseDialog({
  lead,
  onDone,
}: {
  lead: { id: string; name: string; company: string } | null;
  onDone: () => void;
}) {
  const classify = useServerFn(classifySale);
  const [saleType, setSaleType] = useState<SaleType | "">("");
  const [closedOn, setClosedOn] = useState(todayISO());
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Conflict>(null);

  useEffect(() => {
    if (lead) {
      setSaleType("");
      setClosedOn(todayISO());
      setConflict(null);
    }
  }, [lead]);

  const submit = async (confirmedAfterWarning: boolean) => {
    if (!lead || !saleType || !closedOn || !by.trim()) return;
    setBusy(true);
    try {
      const result = await classify({
        data: {
          leadId: lead.id,
          saleType,
          closedOn,
          confirmedAfterWarning,
          updatedBy: by.trim(),
          expectedRevision: null,
        },
      });
      if (!result.ok) {
        setConflict({ priorClosedOn: result.priorClosedOn, priorLeadName: result.priorLeadName });
        return;
      }
      toast.success(
        result.firstAcquisition
          ? "Venda classificada como primeira aquisição deste cliente."
          : "Venda classificada.",
      );
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a classificação.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={lead !== null} onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Classificar venda — {lead?.name || "Sem nome"}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Obrigatório para o cálculo do CAC de mídia. Você pode corrigir depois em Funil → Revisar
          clientes adquiridos.
        </p>
        <SaleTypeFields
          saleType={saleType}
          setSaleType={(v) => {
            setSaleType(v);
            setConflict(null);
          }}
          closedOn={closedOn}
          setClosedOn={setClosedOn}
          by={by}
          setBy={setBy}
        />
        {conflict && (
          <p role="alert" className="flex items-start gap-2 text-xs text-warning-foreground">
            <AlertTriangle className="size-4 shrink-0" />
            Já existe uma aquisição anterior confirmada para este cliente em{" "}
            {fmtDate(conflict.priorClosedOn)} ({conflict.priorLeadName}). Revise o tipo de venda:
            cliente novo conta apenas na primeira aquisição.
          </p>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {conflict ? (
            <>
              <Button disabled={busy} onClick={() => void submit(true)}>
                Manter como cliente novo (não conta como primeira aquisição)
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setConflict(null)}>
                Revisar tipo de venda
              </Button>
            </>
          ) : (
            <Button
              disabled={busy || !saleType || !closedOn || !by.trim()}
              onClick={() => void submit(false)}
            >
              Salvar classificação
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={onDone}>
            Classificar depois
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({
  row,
  from,
  to,
  pipeline,
  onSaved,
}: {
  row: ClosingRow;
  from: string;
  to: string;
  pipeline: string;
  onSaved: () => void;
}) {
  const classify = useServerFn(classifySale);
  const [editing, setEditing] = useState(false);
  const [saleType, setSaleType] = useState<SaleType | "">(row.saleType ?? "");
  const [closedOn, setClosedOn] = useState(row.closedOn ?? row.closedAt ?? row.entryDate);
  const [by, setBy] = useState(row.updatedBy ?? "");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Conflict>(null);

  const submit = async (confirmedAfterWarning: boolean) => {
    if (!saleType || !closedOn || !by.trim()) return;
    setBusy(true);
    try {
      const result = await classify({
        data: {
          leadId: row.leadId,
          saleType,
          closedOn,
          confirmedAfterWarning,
          updatedBy: by.trim(),
          expectedRevision: row.revision,
          from,
          to,
          pipeline,
        },
      });
      if (!result.ok) {
        setConflict({ priorClosedOn: result.priorClosedOn, priorLeadName: result.priorLeadName });
        return;
      }
      toast.success("Classificação salva.");
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a classificação.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{row.name || "Sem nome"}</p>
          <p className="text-xs text-muted-foreground">
            {row.company || "Sem empresa"} ·{" "}
            {row.dateBasis === "closed_at"
              ? `Fechado em ${fmtDate(row.closedAt!)}`
              : `Entrada ${fmtDate(row.entryDate)} · fechamento sem data registrada`}{" "}
            · {row.potentialValue ? currency(row.potentialValue) : "sem valor"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {row.saleType ? (
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs">
              {saleTypeLabel(row.saleType)}
              {row.saleType === "novo" && row.firstAcquisition === false
                ? " · não é a primeira aquisição"
                : ""}
            </span>
          ) : (
            <span className="rounded-full bg-warning/15 px-2.5 py-1 text-xs text-warning-foreground">
              Pendente de classificação
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing((v) => !v);
              setConflict(null);
            }}
          >
            {editing ? "Fechar" : row.saleType ? "Corrigir" : "Classificar"}
          </Button>
        </div>
      </div>
      {row.saleType && row.updatedAt && (
        <p className="text-xs text-muted-foreground">
          Última alteração por {row.updatedBy} em{" "}
          {new Date(row.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} ·
          aquisição confirmada em {fmtDate(row.closedOn!)}
        </p>
      )}
      {editing && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <SaleTypeFields
            saleType={saleType}
            setSaleType={(v) => {
              setSaleType(v);
              setConflict(null);
            }}
            closedOn={closedOn}
            setClosedOn={setClosedOn}
            by={by}
            setBy={setBy}
          />
          {conflict && (
            <p role="alert" className="flex items-start gap-2 text-xs text-warning-foreground">
              <AlertTriangle className="size-4 shrink-0" />
              Já existe uma aquisição anterior confirmada para este cliente em{" "}
              {fmtDate(conflict.priorClosedOn)} ({conflict.priorLeadName}). Cliente novo conta
              apenas na primeira aquisição.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {conflict ? (
              <Button size="sm" disabled={busy} onClick={() => void submit(true)}>
                Manter como cliente novo (não conta como primeira aquisição)
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy || !saleType || !closedOn || !by.trim()}
                onClick={() => void submit(false)}
              >
                Salvar
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** "Revisar clientes adquiridos": lists the period's closings for individual review. */
export function SaleReviewDialog({
  open,
  onOpenChange,
  from,
  to,
  pipeline,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  from: string;
  to: string;
  pipeline: string;
}) {
  const fetchReview = useServerFn(getSaleReview);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["sale-review", from, to, pipeline],
    queryFn: () => fetchReview({ data: { from, to, pipeline } }),
    enabled: open,
    retry: false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["sale-review"] });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revisar clientes adquiridos</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Fechamentos de {fmtDate(from)} a {fmtDate(to)}. Cliente novo conta apenas na primeira
          aquisição confirmada, mesmo com oportunidades em funis diferentes. Datas e valores
          originais são preservados.
        </p>
        {query.isPending && <p className="py-6 text-sm text-muted-foreground">Carregando…</p>}
        {query.error && (
          <p role="alert" className="py-4 text-sm text-destructive">
            {query.error instanceof Error
              ? query.error.message
              : "Não foi possível carregar os fechamentos."}
          </p>
        )}
        {query.data && (
          <>
            <p className="text-xs text-muted-foreground">
              {query.data.closings.length}{" "}
              {query.data.closings.length === 1 ? "fechamento" : "fechamentos"} no período ·{" "}
              {query.data.pending}{" "}
              {query.data.pending === 1 ? "pendente de classificação" : "pendentes de classificação"}{" "}
              · {query.data.newCustomers}{" "}
              {query.data.newCustomers === 1
                ? "cliente novo único"
                : "clientes novos únicos"}
            </p>
            {query.data.closings.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhum fechamento no período selecionado.
              </p>
            )}
            <div className="divide-y">
              {query.data.closings.map((row) => (
                <ReviewRow
                  key={row.leadId}
                  row={row}
                  from={from}
                  to={to}
                  pipeline={pipeline}
                  onSaved={refresh}
                />
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
