import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/prospeccao-b2b/importar-listas")({
 head: () => ({ meta: [{ title: "Importar Listas — Prospecção B2B Pipeflow" }, { name: "description", content: "Importação revisada de contatos e e-mails empresariais no Pipeflow." }, { property: "og:title", content: "Importar Listas — Pipeflow" }, { property: "og:description", content: "Importação revisada de contatos e e-mails empresariais no Pipeflow." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
 component: () => null,
});
