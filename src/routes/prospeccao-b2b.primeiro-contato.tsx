import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/prospeccao-b2b/primeiro-contato")({
 head: () => ({ meta: [{ title: "Primeiro Contato — Prospecção B2B Pipeflow" }, { name: "description", content: "Preparação e acompanhamento dos contatos comerciais no Pipeflow." }, { property: "og:title", content: "Primeiro Contato — Pipeflow" }, { property: "og:description", content: "Preparação e acompanhamento dos contatos comerciais no Pipeflow." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
 component: () => null,
});
