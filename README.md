# Pipeflow — versão experimental de UX (`pipeflow-ux-preview`)

Cópia independente do Pipeflow com as melhorias de navegação, leitura e layout (Financeiro, Recebimentos, Clientes,
ficha do cliente, Visão Geral, Metas e Configurações). **Mesmas cores e identidade visual** do Pipeflow.

- O que mudou, tela a tela: [`docs/ux-melhorias.md`](docs/ux-melhorias.md)
- Prévias das telas (dados fictícios): [`docs/ux-preview/`](docs/ux-preview/)

> Esta cópia **não** se conecta ao banco de produção. Não há senhas, tokens nem dados reais de clientes no repositório.

## Ver a interface funcionando (modo demonstração, sem banco)

O modo demonstração usa dados fictícios gerados no próprio navegador. Nada é salvo nem enviado; ações que gravariam
dados mostram "Modo demonstração: … indisponível". Uma etiqueta azul no topo da tela indica o modo.

Requisitos: Node.js 22 ou mais recente.

```bash
git clone https://github.com/gravoncompany/pipeflow-ux-preview.git
cd pipeflow-ux-preview
npm install
echo "VITE_UX_DEMO=1" > .env
npm run dev
```

Abra o endereço "Local" que aparecer no terminal e navegue:

| Tela | Endereço |
|---|---|
| Controle de Recebimentos | `/financeiro/recebimentos` |
| Aging de recebíveis | `/financeiro/recebimentos?aba=relatorio` |
| Clientes (lista / quadro) | `/clientes` · `/clientes?visao=quadro` |
| Ficha do cliente | clique em um cliente na lista |
| Financeiro | `/financeiro` · `/financeiro/movimentacoes` |
| Visão Geral | `/dashboard` |
| Configurações | `/configuracoes` |
| Busca global | `Ctrl+K` (ou ⌘K) em qualquer tela |

Telas que dependem de integrações (WhatsApp, campanhas, IA etc.) abrem, mas mostram "indisponível" no modo demonstração.

## Usar com um banco de dados (opcional)

Use **um projeto Supabase de teste/homologação**, não o de produção. Copie `.env.example` para `.env`, deixe
`VITE_UX_DEMO` vazio e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (somente a chave pública).
As variáveis de servidor (`SUPABASE_SERVICE_ROLE_KEY`, `CRM_SESSION_SECRET`, senhas do CRM) ficam só no ambiente de
hospedagem, nunca em arquivos do repositório. Sem nenhuma configuração, o build é bloqueado de propósito.

## Verificações

```bash
npx tsc --noEmit
node --import tsx --test src/lib/receipt-insights.test.ts src/lib/client-tabs.test.ts
```

## O que ficou de fora desta cópia

Relatórios operacionais e planos internos do Pipeflow original (`docs/*` de diagnóstico, `roadmap.md`, `.lovable/`)
não foram incluídos, porque descrevem o ambiente de produção. O código, as migrações e os testes estão completos.
