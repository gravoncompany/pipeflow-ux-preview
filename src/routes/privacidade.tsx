import { createFileRoute } from "@tanstack/react-router";
import {
  LegalDocument,
  LegalLink,
  PendingInformation,
  type LegalSection,
} from "@/components/legal/LegalDocument";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — PipeFlow CRM" },
      {
        name: "description",
        content:
          "Minuta da Política de Privacidade do PipeFlow CRM: dados, integrações, segurança e direitos dos titulares.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PrivacyPage,
});

const sections: LegalSection[] = [
  {
    id: "responsavel",
    title: "Escopo e responsável",
    content: (
      <>
        <p>
          Esta política descreve o tratamento de informações no PipeFlow CRM, projeto da Gravon
          Company para gestão de relacionamentos comerciais, leads, funis e conversas. Abrange
          também a Prospecção B2B quando essa funcionalidade estiver habilitada.
        </p>
        <p>
          Os papéis de controlador e operador devem ser definidos de acordo com quem decide a
          finalidade de cada tratamento e com os contratos aplicáveis.
        </p>
        <p>
          Responsável informado: <strong>Gravon Company Marketing LTDA</strong>, CNPJ{" "}
          <strong>41.988.192/0001-73</strong>. Canal oficial de privacidade:{" "}
          <LegalLink href="mailto:contato@gravoncompany.com">contato@gravoncompany.com</LegalLink>.
        </p>
        <PendingInformation>
          O CNPJ informado possui dígitos verificadores válidos. A validação matemática não
          substitui a conferência cadastral no comprovante oficial. Confirmar o endereço, os papéis
          em cada operação e a identificação do encarregado, quando aplicável.
        </PendingInformation>
      </>
    ),
  },
  {
    id: "dados",
    title: "Dados e fontes de informação",
    content: (
      <>
        <ul>
          <li>
            <strong>Cadastros comerciais:</strong> nomes, empresas, telefones, e-mails, sites,
            origem do contato, anotações, histórico de atendimento e etapas do funil, conforme os
            dados inseridos ou importados por usuários autorizados.
          </li>
          <li>
            <strong>Integrações habilitadas:</strong> mensagens e informações de atendimento
            recebidas pelos canais conectados, incluindo WhatsApp pela Evolution API e Instagram.
            Recursos da Gravon IA podem processar conteúdos disponibilizados pelo usuário ou por
            integrações autorizadas para auxiliar o trabalho no CRM. O chat interno envia o
            histórico fornecido à OpenAI; análises de conversas utilizam o gateway de IA da Lovable.
            Resultados de análises e conhecimento comercial podem ser armazenados separadamente das
            conversas.
          </li>
          <li>
            <strong>Prospecção B2B:</strong> segmento, cidade e estado pesquisados; informações
            empresariais retornadas pelo Google Places; e dados de fontes independentes revisadas
            pelo usuário, como cadastro manual ou DeskData, quando configurado.
          </li>
          <li>
            <strong>Operação e acesso:</strong> informações de autenticação, registros de consultas
            e dados técnicos necessários à operação e à segurança. Cookies e armazenamento do
            navegador são utilizados pelas funcionalidades existentes de sessão e preferências.
          </li>
        </ul>
        <p>
          Informações públicas de empresas podem conter dados pessoais, como o nome ou telefone de
          uma pessoa. Sua disponibilidade pública não dispensa a avaliação da finalidade e da base
          legal do uso.
        </p>
      </>
    ),
  },
  {
    id: "finalidades",
    title: "Finalidades e bases legais",
    content: (
      <>
        <p>
          As funcionalidades permitem organizar contatos e oportunidades, acompanhar atendimentos,
          consultar empresas por critérios comerciais, revisar cadastros antes da importação e
          preparar abordagens. Há controles de acesso e consumo para proteger o sistema e limitar
          consultas a provedores.
        </p>
        <p>
          A base legal deve ser avaliada por finalidade e contexto. Consentimento, execução de
          contrato, obrigação legal e legítimo interesse são hipóteses distintas; nenhuma é
          presumida pela simples existência de um cadastro ou resultado de busca.
        </p>
        <PendingInformation>
          Documentar as bases legais efetivamente adotadas, as finalidades de cada integração e,
          quando pertinente, a avaliação de legítimo interesse e a forma de obter ou revogar
          consentimento. Confirmar também o inventário de cookies e eventuais métricas da
          hospedagem.
        </PendingInformation>
      </>
    ),
  },
  {
    id: "google",
    title: "Google Places e dados empresariais",
    content: (
      <>
        <p>
          Quando o usuário realiza uma busca, o servidor envia ao Google Places o segmento, a cidade
          e o estado informados e, na paginação, o identificador necessário para continuar a
          consulta. Essa busca não envia ao Google a lista de leads ou o conteúdo das conversas do
          CRM.
        </p>
        <p>
          Os resultados podem incluir nome empresarial, categoria, endereço, telefone, site, link do
          Google Maps e atribuições dos provedores. Eles são exibidos para consulta; o fluxo B2B não
          grava a resposta do Places como cadastro empresarial no banco. O identificador do local,{" "}
          <code>place_id</code>, pode ser associado a um cadastro revisado.
        </p>
        <p>
          A importação exige dados obtidos de fonte independente autorizada e confirmação do usuário
          sobre a identidade da empresa e a possibilidade de armazenamento. A confirmação na
          interface não constitui consentimento do titular nem validação jurídica automática.
        </p>
        <p>
          O tratamento realizado pelo Google é descrito na{" "}
          <LegalLink href="https://policies.google.com/privacy?hl=pt-BR">
            Política de Privacidade do Google
          </LegalLink>
          , incorporada a esta seção no que se refere à integração. Consulte também os{" "}
          <LegalLink href="https://www.google.com/intl/pt-BR/help/terms_maps/">
            Termos adicionais do Google Maps e Google Earth
          </LegalLink>
          .
        </p>
      </>
    ),
  },
  {
    id: "compartilhamento",
    title: "Provedores e compartilhamento",
    content: (
      <>
        <p>
          O código do projeto contempla Lovable Cloud e Supabase para infraestrutura; Google Places
          para buscas B2B; Evolution API para WhatsApp; serviços da Meta para Instagram; Google
          Sheets para planilhas; OpenAI e o gateway de IA da Lovable para as respectivas funções de
          IA; e DeskData para consultas empresariais. Há também integração de entrada e saída de
          leads por webhooks, incluindo Zapier, quando configurada. A presença de uma integração no
          código não confirma sua contratação ou ativação neste ambiente.
        </p>
        <p>
          O acesso ou envio de informações a cada serviço depende da funcionalidade utilizada. A
          visita a estas páginas não inicia uma busca de empresas, uma importação ou um envio de
          mensagem.
        </p>
        <PendingInformation>
          Confirmar os fornecedores e operadores efetivamente contratados, quais dados cada um
          recebe, países de tratamento, condições contratuais e mecanismos aplicáveis a eventuais
          transferências internacionais. Não se presume armazenamento exclusivo no Brasil.
        </PendingInformation>
      </>
    ),
  },
  {
    id: "armazenamento",
    title: "Armazenamento e segurança",
    content: (
      <>
        <p>
          O CRM mantém os registros necessários às funcionalidades utilizadas. Na Prospecção B2B, a
          implementação prevê cadastros revisados, histórico de consultas, rascunhos de e-mail e uma
          lista de bloqueio de endereços para abordagem por esse módulo. Um rascunho revisado não
          significa mensagem enviada.
        </p>
        <p>
          A implementação possui exclusão manual de leads restrita ao acesso completo. Essa ação não
          equivale à eliminação de todas as informações relacionadas: mensagens, análises,
          conhecimento e registros de operações podem permanecer em estruturas separadas. Vínculos
          com registros de atendimento e auditoria podem impedir a exclusão de um cadastro.
        </p>
        <p>
          No chat interno da Gravon IA, o histórico textual também é salvo no navegador. O comando
          “Limpar conversa” remove esse histórico local; não elimina automaticamente registros já
          enviados a provedores ou salvos como conhecimento. A sessão do CRM tem validade de até 12
          horas, o que não determina o prazo de armazenamento dos cadastros e mensagens.
        </p>
        <p>
          Na revisão do código não foi identificada uma rotina geral de exclusão por idade dos
          dados. Os prazos de retenção e os procedimentos de eliminação, inclusive em serviços
          externos e backups, ainda precisam ser definidos e verificados. Isso não autoriza a
          conservação de dados sem necessidade ou fundamento aplicável.
        </p>
        <p>
          As áreas operacionais permanecem protegidas por autenticação e verificações de permissão
          no servidor. As credenciais de provedores ficam no backend. Essas medidas reduzem riscos,
          mas não representam garantia absoluta de segurança.
        </p>
        <PendingInformation>
          Aprovar critérios de revisão e descarte para leads, mensagens, análises de IA, registros
          B2B e evidências de consentimento ou bloqueio; definir o responsável por atender pedidos e
          as exceções de conservação justificadas. Confirmar backups, fornecedores e resposta a
          incidentes. Nenhum prazo proposto foi adotado como prática nesta minuta.
        </PendingInformation>
      </>
    ),
  },
  {
    id: "direitos",
    title: "Direitos dos titulares",
    content: (
      <>
        <p>
          Nos termos da LGPD e conforme aplicável, o titular pode solicitar confirmação e acesso ao
          tratamento, correção, anonimização, bloqueio ou eliminação de dados desnecessários ou
          irregulares; portabilidade nos limites regulamentares; informações sobre compartilhamento;
          e revogação do consentimento. Também pode se opor a tratamento irregular e solicitar
          revisão de decisões exclusivamente automatizadas que afetem seus interesses.
        </p>
        <p>
          Os pedidos devem ser avaliados com verificação proporcional de identidade, respeito aos
          direitos de terceiros e às hipóteses legais de conservação. A eventual solicitação de não
          receber contatos deve ser encaminhada ao responsável; a lista de bloqueio B2B não
          substitui o atendimento dos demais direitos.
        </p>
        <p>
          A referência legal é a{" "}
          <LegalLink href="https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-normaatualizada-pl.html">
            Lei nº 13.709/2018 — LGPD
          </LegalLink>
          . O titular também pode recorrer à ANPD, conforme os canais e requisitos aplicáveis.
        </p>
      </>
    ),
  },
  {
    id: "contato",
    title: "Contato e atualização",
    content: (
      <>
        <p>
          Solicitações sobre privacidade e proteção de dados pessoais devem ser encaminhadas à
          Gravon Company Marketing LTDA pelo e-mail{" "}
          <LegalLink href="mailto:contato@gravoncompany.com">contato@gravoncompany.com</LegalLink>.
          Informe o direito que deseja exercer e os elementos necessários para localizar o
          tratamento, evitando enviar dados excessivos ou documentos sensíveis sem orientação.
        </p>
        <p>
          Antes da publicação, o responsável deve concluir os campos pendentes, revisar as práticas
          descritas e aprovar a versão e sua data de vigência. Mudanças relevantes deverão ser
          comunicadas de forma adequada ao tratamento realizado.
        </p>
        <p>
          Consulte também os <LegalLink href="/termos">Termos de Uso do PipeFlow CRM</LegalLink>.
        </p>
      </>
    ),
  },
];

function PrivacyPage() {
  return (
    <LegalDocument
      kind="privacidade"
      title="Política de Privacidade"
      description="Como as informações são utilizadas no CRM e na Prospecção B2B, quais cuidados se aplicam e como exercer seus direitos."
      sections={sections}
    />
  );
}
