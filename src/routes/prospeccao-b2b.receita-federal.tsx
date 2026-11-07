import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/prospeccao-b2b/receita-federal")({
 head: () => ({ meta: [{ title: "Receita Federal — Prospecção B2B Pipeflow" }, { name: "description", content: "Pesquisa de empresas de Santa Catarina por CNAE e CNPJ com revisão no Pipeflow." }, { property: "og:title", content: "Receita Federal — Pipeflow" }, { property: "og:description", content: "Pesquisa de empresas de Santa Catarina por CNAE e CNPJ com revisão no Pipeflow." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
 component: () => null,
});
