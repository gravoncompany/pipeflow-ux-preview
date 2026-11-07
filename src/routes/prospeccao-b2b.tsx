import { createFileRoute } from "@tanstack/react-router";
import { B2bWorkspace } from "@/components/crm/b2b/B2bWorkspace";
import { parseB2bStep, type B2bStep } from "@/lib/b2b-flow";
export const Route = createFileRoute("/prospeccao-b2b")({
  validateSearch: (s: Record<string, unknown>): { etapa?: Exclude<B2bStep, "buscar"> } => {
    const etapa = parseB2bStep(s.etapa);
    return etapa && etapa !== "buscar" ? { etapa } : {};
  },
  head: () => ({
    meta: [
      { title: "Prospecção B2B — PipeFlow CRM" },
      {
        name: "description",
        content:
          "Pesquisa de empresas e preparação de contatos comerciais com revisão antes de importar.",
      },
      { property: "og:title", content: "Prospecção B2B — PipeFlow CRM" },
      {
        property: "og:description",
        content: "Consulta empresarial por CNPJ e revisão de cadastros no PipeFlow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: B2bWorkspace,
});
