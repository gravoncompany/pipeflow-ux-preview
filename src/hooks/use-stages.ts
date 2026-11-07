import { useCallback, useEffect, useState } from "react";
import { DEFAULT_STAGES, type Stage } from "@/lib/crm-types";

const KEY = "crm.stages.v1";

function load(): Stage[] {
  if (typeof window === "undefined") return DEFAULT_STAGES;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STAGES;
    const parsed = JSON.parse(raw) as Stage[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_STAGES;
    return parsed.filter((s) => s && typeof s.id === "string" && typeof s.title === "string");
  } catch {
    return DEFAULT_STAGES;
  }
}

function save(stages: Stage[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(stages));
    window.dispatchEvent(new CustomEvent("crm-stages-changed"));
  } catch {}
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `col-${Math.random().toString(36).slice(2, 7)}`;
}

export function useStages() {
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES);

  useEffect(() => {
    setStages(load());
    const onChange = () => setStages(load());
    window.addEventListener("crm-stages-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("crm-stages-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const persist = useCallback((next: Stage[]) => {
    setStages(next);
    save(next);
  }, []);

  const addStage = useCallback((title: string) => {
    const t = title.trim();
    if (!t) return;
    const current = load();
    let id = slugify(t);
    let i = 2;
    while (current.some((s) => s.id === id)) id = `${slugify(t)}-${i++}`;
    persist([...current, { id, title: t }]);
  }, [persist]);

  const removeStage = useCallback((id: string) => {
    const current = load();
    if (current.length <= 1) return;
    persist(current.filter((s) => s.id !== id));
  }, [persist]);

  const moveStage = useCallback((id: string, dir: -1 | 1) => {
    const current = load();
    const idx = current.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= current.length) return;
    const next = current.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    persist(next);
  }, [persist]);

  const renameStage = useCallback((id: string, title: string) => {
    const t = title.trim();
    if (!t) return;
    const current = load();
    persist(current.map((s) => (s.id === id ? { ...s, title: t } : s)));
  }, [persist]);

  return { stages, addStage, removeStage, moveStage, renameStage };
}
