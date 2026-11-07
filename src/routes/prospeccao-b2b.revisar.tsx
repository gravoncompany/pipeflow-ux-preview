import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/prospeccao-b2b/revisar")({
 head: () => ({ meta: [{ title: "Revisar Selecionadas — Prospecção B2B Pipeflow" }, { name: "description", content: "Revisão das empresas selecionadas antes do cadastro no CRM Pipeflow." }, { property: "og:title", content: "Revisar Selecionadas — Pipeflow" }, { property: "og:description", content: "Revisão das empresas selecionadas antes do cadastro no CRM Pipeflow." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
 component: () => null,
});
