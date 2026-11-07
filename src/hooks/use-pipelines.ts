import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listPipelines, savePipeline } from "@/lib/pipelines.functions";
import { MAIN_PIPELINE, type Pipeline } from "@/lib/pipelines";

export function usePipelines(enabled: boolean) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selected, setSelected] = useState(MAIN_PIPELINE);
  const [loading, setLoading] = useState(false);
  const list = useServerFn(listPipelines);
  const save = useServerFn(savePipeline);
  useEffect(() => {
    if (!enabled) { setSelected(MAIN_PIPELINE); return; }
    let active = true;
    setLoading(true);
    list().then((items) => {
      if (!active) return;
      setPipelines(items);
      const stored = localStorage.getItem("crm.pipeline.selected");
      setSelected(items.some((p) => p.id === stored) && stored ? stored : MAIN_PIPELINE);
    }).catch(() => { if (active) toast.error("Não foi possível carregar os funis."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [enabled, list]);
  const select = (id: string) => { setSelected(id); localStorage.setItem("crm.pipeline.selected", id); };
  const persist = async (input: { id?: string; name: string; stages: Pipeline["stages"] }) => {
    try {
      const saved = await save({ data: input });
      setPipelines((items) => [...items.filter((p) => p.id !== saved.id), saved]);
      return saved;
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar o funil."); return null; }
  };
  return { pipelines, selected, select, persist, loading };
}