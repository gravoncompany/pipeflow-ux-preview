import { PipeflowLogo } from "@/components/brand/PipeflowLogo";
import type { ReactNode } from "react";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type LegalSection = { id: string; title: string; content: ReactNode };

export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="font-medium text-blue-700 underline decoration-blue-200 underline-offset-4 hover:decoration-blue-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700"
    >
      {children}
    </a>
  );
}

export function PendingInformation({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
      <strong>Pendente de revisão: </strong>
      {children}
    </p>
  );
}

export function LegalDocument({
  kind,
  title,
  description,
  sections,
}: {
  kind: "privacidade" | "termos";
  title: string;
  description: string;
  sections: LegalSection[];
}) {
  const Icon = kind === "privacidade" ? ShieldCheck : FileText;
  return (
    <div
      lang="pt-BR"
      className="min-h-screen bg-white text-slate-900"
      style={{ colorScheme: "light" }}
    >
      <a
        href="#documento"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-4 focus:text-blue-700 focus:shadow-lg"
      >
        Pular para o documento
      </a>
      <header className="border-b border-blue-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <a href="/" aria-label="PipeFlow CRM — acesso ao sistema">
            <PipeflowLogo symbolClassName="h-9 w-9" textClassName="text-xl text-primary" />
          </a>
          <nav
            aria-label="Documentos legais"
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium"
          >
            <a
              href="/privacidade"
              aria-current={kind === "privacidade" ? "page" : undefined}
              className={
                kind === "privacidade"
                  ? "text-blue-700 underline underline-offset-8"
                  : "text-slate-600 hover:text-blue-700"
              }
            >
              Privacidade
            </a>
            <a
              href="/termos"
              aria-current={kind === "termos" ? "page" : undefined}
              className={
                kind === "termos"
                  ? "text-blue-700 underline underline-offset-8"
                  : "text-slate-600 hover:text-blue-700"
              }
            >
              Termos de Uso
            </a>
          </nav>
        </div>
      </header>
      <main id="documento" tabIndex={-1} className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold tracking-wide text-blue-700">
            <Icon aria-hidden="true" className="size-4" /> PIPEFLOW CRM · GRAVON COMPANY
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg">{description}</p>
          <p className="mt-4 text-xs text-slate-500">
            Minuta elaborada em <time dateTime="2026-11-01">1º de novembro de 2026</time>
          </p>
        </div>
        <aside
          aria-label="Status do documento"
          className="my-8 rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-950"
        >
          <p className="font-semibold">Minuta para revisão — ainda não vigente</p>
          <p className="mt-2 max-w-3xl text-sm leading-6">
            Este documento aguarda confirmação das informações indicadas e aprovação do responsável
            antes da publicação. Esta versão não ativa a Prospecção B2B nem substitui a revisão das
            práticas de tratamento de dados.
          </p>
        </aside>
        <div className="grid items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
          <nav
            aria-label="Sumário do documento"
            className="rounded-xl border border-blue-100 bg-slate-50 p-5 lg:sticky lg:top-6"
          >
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-blue-700">
              Neste documento
            </p>
            <ol className="space-y-3">
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="block text-sm leading-5 text-slate-600 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700"
                  >
                    <span className="mr-2 text-blue-700">{String(index + 1).padStart(2, "0")}</span>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <Card className="min-w-0 border-slate-200 bg-white text-slate-900 shadow-none">
            <CardContent className="space-y-9 p-5 sm:p-8">
              {sections.map((section, index) => (
                <section
                  key={section.id}
                  id={section.id}
                  aria-labelledby={`${section.id}-titulo`}
                  className="scroll-mt-8"
                >
                  <h2
                    id={`${section.id}-titulo`}
                    className="mb-4 text-xl font-semibold tracking-tight"
                  >
                    <span className="mr-2 text-blue-700">{index + 1}.</span>
                    {section.title}
                  </h2>
                  <div className="space-y-4 break-words text-[15px] leading-7 text-slate-600 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_strong]:font-semibold [&_strong]:text-slate-800">
                    {section.content}
                  </div>
                </section>
              ))}
            </CardContent>
          </Card>
        </div>
      </main>
      <footer className="border-t border-blue-100 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8">
          <p className="text-sm text-slate-500">PipeFlow CRM · Documentos legais em revisão</p>
          <Button
            variant="outline"
            asChild
            className="border-blue-200 bg-white text-blue-700 hover:bg-blue-50 hover:text-blue-800"
          >
            <a href="/">
              <ArrowLeft aria-hidden="true" /> Acessar o CRM
            </a>
          </Button>
        </div>
      </footer>
    </div>
  );
}
