import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { type Lead } from "@/lib/crm-types";
import { listCrmLeads, saveCrmLead, moveCrmLead, deleteCrmLeads, getCrmZapierSetting, saveCrmZapierSetting } from "@/lib/crm-leads.functions";
import { toast } from "sonner";

export function useLeads() {
  const [leads, setLeadsState] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [zapierUrl, setZapierUrl] = useState<string>("");
  const list = useServerFn(listCrmLeads);
  const save = useServerFn(saveCrmLead);
  const move = useServerFn(moveCrmLead);
  const remove = useServerFn(deleteCrmLeads);
  const getSetting = useServerFn(getCrmZapierSetting);
  const saveSetting = useServerFn(saveCrmZapierSetting);

  const refetch = useCallback(async () => {
    try { setLeadsState(await list()); }
    catch { setLeadsState([]); }
    finally { setLoading(false); }
  }, [list]);

  useEffect(() => {
    refetch();
    void getSetting().then(setZapierUrl).catch(() => setZapierUrl(""));
    const refreshVisible = () => { if (document.visibilityState === "visible") void refetch(); };
    const timer = window.setInterval(refreshVisible, 30000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refreshVisible); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [refetch, getSetting]);

  const upsertLead = useCallback(async (lead: Lead, opts?: { isNew?: boolean }) => {
    try { await save({ data: { lead, isNew: opts?.isNew } }); await refetch(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar o lead."); void refetch(); throw error; }
  }, [save, refetch]);

  const updateStage = useCallback(async (id: string, stage: Lead["stage"]) => {
    setLeadsState((prev) => prev.map((l) => (l.id === id ? { ...l, stage } : l)));
    try { await move({ data: { id, stage } }); await refetch(); }
    catch { toast.error("Não foi possível mover o lead."); await refetch(); }
  }, [move, refetch]);

  const deleteLead = useCallback(async (id: string) => {
    try { await remove({ data: { ids: [id] } }); await refetch(); }
    catch { toast.error("Não foi possível excluir o lead."); }
  }, [remove, refetch]);

  const deleteLeads = useCallback(async (ids: string[]) => {
    if (!ids.length) return false;
    try { await remove({ data: { ids } }); await refetch(); return true; }
    catch { toast.error("Não foi possível excluir os leads."); return false; }
  }, [remove, refetch]);

  const saveZapierUrl = useCallback(async (url: string) => {
    await saveSetting({ data: { url } });
    setZapierUrl(url);
  }, [saveSetting]);

  return { leads, loading, refetch, upsertLead, updateStage, deleteLead, deleteLeads, zapierUrl, saveZapierUrl };
}
