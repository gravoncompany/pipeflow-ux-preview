# Laboratório de design moderno

Segunda rodada da versão experimental: visual mais moderno, com movimento e leitura mais limpa,
**mantendo a mesma paleta azul/azul-marinho do Pipeflow e todas as funções**. A versão anterior (só UX) está na tag `ux-v1`.

Prévias: [`docs/lab-preview/`](lab-preview/) (imagens e o vídeo `demo-animacoes.webm`).

## Base visual (`src/styles.css`, componentes `ui/`)
- Fundo com luz azul muito sutil; superfícies com sombra em camadas e elevação ao passar o mouse (`.surface`, `.surface-hover`, `.glass`).
- Botão principal com gradiente da marca e brilho; botões pressionam levemente ao clicar; campos com anel de foco suave.
- Abas com transição; telas entram com animação curta; listas de cartões aparecem em cascata.
- Tudo respeita "reduzir movimento" do sistema operacional.

## Navegação
- **Menu principal**: fundo azul-marinho com profundidade, indicador do item ativo que **desliza** entre as áreas,
  ícones com micro-animação, blocos separados por linhas (os mesmos nove itens, na mesma ordem, sem títulos de categoria),
  dicas (tooltips) com o menu recolhido, menu fixo durante a rolagem.
- **Submenu das áreas**: em vidro, com marcador ativo animado e barra lateral; breadcrumb fixo no topo.

## Card do lead (Pipeline / Conversas)
- Cabeçalho único com avatar, nome, empresa, valor (potencial ou fechado), etapa, funil, origem e etiquetas.
- **Barra de etapas** clicável (mostra "Etapa X de N"; a mudança vale ao salvar).
- **Ações rápidas**: WhatsApp, e-mail, Instagram, site e "Registrar interação".
- Abas: **Visão geral** (próximo passo, última atualização, informações complementares, Pipeflow IA, qualificação — sem repetir
  os dados do cabeçalho), **Atividade** (linha do tempo, anotações, WhatsApp, e-mail em seletor animado) e
  **Dados e consultas** (grupos recolhíveis: cadastro e etiquetas, origem da campanha, consultas).
- Cartões do quadro com avatar de iniciais, elevação e colunas com faixa de cor.

## Visão Geral (dashboard) e gráficos
- Topo com data e título; bloco "Isto pede atenção hoje".
- **Destaque do MRR** em cartão da marca com tendência do período, ARR, clientes ativos e ticket médio.
- Indicadores com **contagem animada** e **mini-gráficos** (retorno operacional, margem).
- Gráficos organizados em abas (**Receita e carteira**, **Eficiência e marketing**, **Todos os indicadores**) para reduzir a rolagem;
  áreas com gradiente, barras arredondadas, tooltip em vidro, eixos discretos e estado vazio compacto.
- Seletor de período em pílulas animadas. Financeiro usa o mesmo estilo de gráfico.

## Modo demonstração
O Pipeline agora também abre no modo demonstração, com 14 leads fictícios, e a Visão Geral mostra gráficos calculados pelas
**mesmas funções do sistema** (`growthMetrics`, `unitEconomics`) sobre uma carteira fictícia.
