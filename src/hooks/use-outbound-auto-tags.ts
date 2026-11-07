import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listOutboundAutoTags } from "@/lib/outbound-auto-tags.functions";

/** Etiquetas automáticas do Outbound por card (somente leitura, atualiza a cada minuto). */
export function useOutboundAutoTags(): Record<string, string[]> {
  const list = useServerFn(listOutboundAutoTags);
  const q = useQuery({ queryKey: ["outbound-auto-tags"], queryFn: () => list(), refetchInterval: 60_000, staleTime: 30_000, retry: false });
  return q.data?.authorized ? q.data.tags : {};
}
