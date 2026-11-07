# Pipeflow — melhorias de UX, layout e navegação

Cópia independente do Pipeflow (base: `gravoncompany/boardly-leads@ac59616`) com as melhorias da análise de UX.
As cores, tokens (`src/styles.css`) e a identidade visual não foram alterados. Nenhuma função de servidor, regra de
acesso, migração ou fluxo de escrita foi modificado; todas as telas novas leem as mesmas funções protegidas já existentes.

As imagens em `docs/ux-preview/` foram capturadas com **dados fictícios simulados no navegador de teste** (sem banco,
sem envios), só para visualizar os layouts.

## Navegação global
- **Busca global Ctrl+K / ⌘K** (`ux/CommandPalette.tsx`): telas de todas as áreas + clientes (nome, razão social, CNPJ,
  contato), com atalho direto para os recebimentos do cliente. Botão "Buscar…" no menu principal. Montada só dentro do
  menu do CRM (atrás do portão); clientes são lidos pela mesma função protegida da tela Clientes.
- **Breadcrumb** no topo de todas as áreas com submenu (`AreaLayout` + `ux/nav-catalog.ts`).
- **Configurações** abre numa página-índice (`/configuracoes`) com cartões de todas as configurações e integrações,
  protegida pelo mesmo portão (`getCrmAccess`, verificação leve sem leitura de dados).

## Controle de Recebimentos
- **Fila "o que fazer hoje"**: atrasados (dias de atraso), vencendo em 7 dias e aguardando conciliação, com "Abrir",
  "Conciliar" e **copiar lembrete de cobrança** (texto pronto para colar na conversa; nada é enviado automaticamente).
- **Cartões clicáveis** (Recebido/Pendente/Atrasado filtram as tabelas) com barra de % realizado.
- **Abas** no lugar da página longa: Visão anual · Quinzenais e semanais · Conciliação (n) · Aging e relatório · Configurações (n).
  O seletor de mês só aparece onde ele vale (aba mensal).
- **Aging de recebíveis** (a vencer, 1–15, 16–30, 31–60, +60), % de inadimplência e maiores saldos atrasados por cliente.
- **Filtros na URL** (`?cliente=&situacao=&q=&ano=&mes=&aba=`) — dá para salvar/compartilhar "atrasados de novembro".
- **Datas em dd/mm/aaaa** em toda a tela; **diálogos de confirmação** com resumo (cliente, valor, cobrança, conta) no lugar de `window.confirm`.
- Células da grade anual com **símbolo + cor** (✓ pago, ○ pendente, ! atrasado, ◐ parcial, ⇄ conciliação) e a mesma legenda.
- **Exportar CSV** da visão filtrada; totais fixos no rodapé (desktop); esqueleto de carregamento.
- Sem recarga automática a cada 30 s: atualiza ao voltar para a janela (não mexe na tela durante a conferência).

## Clientes
- **Lista com colunas de negócio**: MRR, próximo vencimento, situação financeira (Em dia / Atrasado Nd + último pagamento),
  saúde de CS, renovação (alerta ≤30 dias), ordenáveis. Situação como selo colorido.
- **Cartões clicáveis**: Ativos/Implantação/Pausados/Encerrados filtram; novos cartões MRR da carteira, Com atraso e Precisam de atenção.
- **Visão Quadro** por fase (Implantação › Ativo › Pausado › Encerrado).
- Linha inteira clicável; ações secundárias num menu "⋯"; **barra de seleção** só aparece com clientes selecionados.
- Busca, situação, ordem, filtro e visão ficam na URL e são lembrados ao voltar da ficha.
- Leituras complementares (CS e recebimentos) são opcionais: sem acesso, as colunas mostram "—".

## Ficha do cliente
- **11 abas → 5 seções**: Visão geral · Relacionamento (Conversas, Registros e Tarefas, Histórico) · Entregas (Projetos,
  Planejamento, Documentos) · Financeiro · Inteligência (Customer Success, Conhecimento). Cadastro fica no botão do cabeçalho.
  Endereços antigos (`?aba=conversas`, `?aba=financeiro`…) continuam funcionando.
- **Cabeçalho fixo** com mensalidade do mês, próximo vencimento, situação financeira, último pagamento e tarefas abertas,
  e ações rápidas (WhatsApp, Nova tarefa, Registrar pagamento, Cadastro).
- **Cadastro X% completo** com barra e botão "Completar cadastro"; **Atividade recente** (linha do tempo resumida).

## Financeiro
- Ícone próprio para **Custos**; **Finanças Pessoais** num grupo "Privado" com cadeado e faixa de aviso na área pessoal.
- **Ação principal por tela** (Novo lançamento / Nova despesa / Nova meta / Exportar PDF) e **período único** no cabeçalho
  (DRE, relatórios e faturamento seguem o mesmo mês).
- Visão geral começa por **"Precisa da sua atenção"**: recebimentos atrasados, a receber em 7 dias, contas a pagar em
  7 dias e **saldo projetado em 30 dias** (com alerta de quando fica negativo).
- Faturamento do mês com **comparação vs mês anterior**.
- **Tabela de lançamentos**: ordenação por coluna, filtro por situação, dias de atraso no selo, **totais no rodapé** e
  "Mostrar mais" (50 por vez). "Próximos vencimentos" mostra só o que está em aberto.
- Contas a Receber explica o papel de cada tela e leva ao Controle de Recebimentos.
- Relatórios: **concentração de receita** (12 meses) com alerta de dependência dos 3 maiores.

## Visão Geral e Metas
- Dashboard abre com **"Bom dia! Isto pede atenção hoje"**: leads aguardando resposta, retornos atrasados, cobranças
  atrasadas e renovações em 30 dias, cada cartão levando à tela onde se resolve.
- Metas x realizado mostram o **ritmo necessário**: "Faltam X em N dias úteis ≈ Y por dia".

## Componentes compartilhados (`src/components/crm/ux/`)
`KpiCard`, `StatusPill` (cor + ícone + texto, tons unificados), `ConfirmProvider/useConfirm`, `CommandPalette`, `nav-catalog`.
Funções puras novas com testes: `src/lib/ux-format.ts`, `src/lib/receipt-insights.ts`, `src/lib/finance-insights.ts`,
grupos da ficha em `src/lib/client-tabs.ts`.

## Validação
- `npx tsc --noEmit` sem erros; `npm run build` OK.
- Testes unitários (`node --import tsx --test …`, 179 arquivos não-integração): 1097 passam; 1 falha **já existia na base**
  (`area-groups.test.ts`, que espera um menu de Atendimento diferente do atual).
- Telas verificadas em 1440 px e em celular (390 px) sem transbordamento horizontal, com dados fictícios simulados.
- Não verificado com a base real (exige a senha do CRM e o Supabase).

## Publicação experimental (pipeflow-ux-preview)
- **Modo demonstração** (`VITE_UX_DEMO=1`, `src/ux-demo/demo.ts`): responde às funções de servidor no navegador com
  dados fictícios, sem banco; nenhuma gravação ou envio. Desligado por padrão.
- **Sem conexão embutida com produção**: `config/cloud-public-binding.ts` não traz mais endereço nem chave; o banco é
  configurado por variáveis de ambiente (`.env.example`). `supabase/config.toml` usa um identificador genérico.
- Relatórios operacionais, `roadmap.md` e `.lovable/` do original não foram incluídos.
