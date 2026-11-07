import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/prospeccao-b2b/instagram")({
  head: () => ({
    meta: [
      { title: "Instagram — Prospecção B2B Pipeflow" },
      { name: "description", content: "Pesquisa de empresas por hashtags do Instagram com revisão antes de cadastrar no Pipeflow." },
      { property: "og:title", content: "Instagram — Prospecção B2B Pipeflow" },
      { property: "og:description", content: "Pesquisa de empresas por hashtags do Instagram com revisão antes de cadastrar no Pipeflow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => null,
});
