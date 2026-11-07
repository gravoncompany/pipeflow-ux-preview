# Laboratório de design moderno

Segunda rodada da versão experimental: visual mais moderno, com movimento e leitura mais limpa,
**mantendo a mesma paleta azul/azul-marinho do Pipeflow e todas as funções**. A versão anterior (só UX) está no branch `ux-v1`.

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

## Rodada 3 · Clientes, Pós-venda e Prospecção B2B

### Clientes + Pós-venda como uma área só
- Abas no topo **Carteira de clientes | Pós-venda** ligam a lista de clientes e a gestão de pós-venda (mesmos endereços).
- No menu de Atendimento, "Gestão de Clientes" passou a se chamar **Pós-venda**.
- As 6 visões do pós-venda viraram **4 seções**: Acompanhamento · Saúde e risco (Visão da carteira, Clientes em risco, Pontuação) · Renovações · Indicadores.
  A seção Saúde e risco mostra quantos clientes precisam de atenção.
- Cartões de saúde **clicáveis** (Saudável, Atenção, Em risco, Sem avaliação) filtram a lista; cartão de MRR ativo.
- Filtros avançados recolhidos em **Filtros** (com contador e "Limpar filtros"); busca sempre visível.
- Acompanhamento abre no **quadro por etapa**, com saúde, pontuação, mensalidade, próximo contato e atraso em cada cartão.

### Prospecção B2B em 3 etapas
- Menu com **3 etapas** em vez de 6 itens: 1 · Encontrar empresas → 2 · Revisar e adicionar → 3 · Primeiro contato.
- Google Maps, Instagram, Receita Federal e Importar lista viraram **abas da etapa 1** (mesmos endereços; a seleção continua guardada ao trocar de fonte).
- Barra de etapas no topo com contadores (selecionadas, prontas, a abordar, abordadas); a marca de concluída só aparece com resultado real.
- Etapa 2: o **caminho rápido** vem primeiro — *1 Identificar CNPJ* → *2 Adicionar ao CRM* para todas as selecionadas de uma vez;
  a revisão empresa por empresa ficou como **opcional** (lista recolhida em 5, "Ver todas").
- "Selecionar visíveis" só aparece quando há filtro ativo (antes duplicava "Selecionar todos").
- Nenhuma regra mudou: mesmas consultas, limites, confirmações, consultas pagas e importação revisada.
