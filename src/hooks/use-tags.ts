import { useCallback, useEffect, useState } from "react";
import { DEFAULT_TAGS, type Tag } from "@/lib/crm-types";

const KEY = "crm.tags.v1";
const clickTag: Tag = { id: 'clicou-no-link', label: 'Clicou no link', color: 'var(--primary)' };
const withClickTag = (tags: Tag[]) => [...tags.filter(t => t.id !== clickTag.id), clickTag];

function load(): Tag[] {
  if (typeof window === "undefined") return withClickTag(DEFAULT_TAGS);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return withClickTag(DEFAULT_TAGS);
    const parsed = JSON.parse(raw) as Tag[];
    if (!Array.isArray(parsed) || parsed.length === 0) return withClickTag(DEFAULT_TAGS);
    return withClickTag(parsed.filter(
      (t) => t && typeof t.id === "string" && typeof t.label === "string" && typeof t.color === "string",
    ));
  } catch {
    return withClickTag(DEFAULT_TAGS);
  }
}

function save(tags: Tag[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tags));
    window.dispatchEvent(new CustomEvent("crm-tags-changed"));
  } catch {}
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `tag-${Math.random().toString(36).slice(2, 7)}`
  );
}

const PALETTE = [
  "oklch(0.65 0.22 25)",
  "oklch(0.78 0.15 70)",
  "oklch(0.65 0.13 230)",
  "oklch(0.6 0.25 15)",
  "oklch(0.78 0.13 85)",
  "oklch(0.6 0.05 250)",
  "oklch(0.65 0.1 290)",
  "oklch(0.6 0.18 200)",
  "oklch(0.65 0.16 155)",
  "oklch(0.5 0.04 260)",
  "oklch(0.6 0.12 50)",
  "oklch(0.7 0.18 140)",
  "oklch(0.65 0.2 320)",
  "oklch(0.7 0.15 180)",
];

export function useTags() {
  const [tags, setTags] = useState<Tag[]>(withClickTag(DEFAULT_TAGS));

  useEffect(() => {
    setTags(load());
    const onChange = () => setTags(load());
    window.addEventListener("crm-tags-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("crm-tags-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const persist = useCallback((next: Tag[]) => {
    setTags(withClickTag(next));
    save(withClickTag(next));
  }, []);

  const addTag = useCallback(
    (label: string, color?: string) => {
      const l = label.trim();
      if (!l) return;
      const current = load();
      let id = slugify(l);
      let i = 2;
      while (current.some((t) => t.id === id)) id = `${slugify(l)}-${i++}`;
      const c = color || PALETTE[current.length % PALETTE.length];
      persist([...current, { id, label: l, color: c }]);
    },
    [persist],
  );

  const removeTag = useCallback(
    (id: string) => {
      const current = load();
      persist(current.filter((t) => t.id !== id));
    },
    [persist],
  );

  return { tags, addTag, removeTag, palette: PALETTE };
}
