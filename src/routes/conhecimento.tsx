import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/conhecimento")({
  head: () => ({ meta: [
    { title: "Conhecimento comercial — Gravon AI" },
    { name: "description", content: "Conhecimento comercial e recomendações reunidos na Gravon AI." },
    { property: "og:title", content: "Conhecimento comercial — Gravon AI" },
    { property: "og:description", content: "Aprendizados do atendimento comercial na Gravon AI." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: () => { throw redirect({ to: "/gravon-ai", search: { tab: "knowledge" } }); },
});