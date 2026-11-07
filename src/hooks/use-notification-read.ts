import { useEffect, useState } from "react";
const KEY = "crm.notifications.read.v1";
export function useNotificationRead() {
  const [read, setRead] = useState<Set<string>>(new Set());
  useEffect(() => { try { const data = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(data)) setRead(new Set(data.filter((id) => typeof id === "string"))); } catch {} }, []);
  const markRead = (ids: string[]) => setRead((previous) => { const next = new Set([...previous, ...ids]); localStorage.setItem(KEY, JSON.stringify([...next].slice(-5000))); return next; });
  return { read, markRead };
}