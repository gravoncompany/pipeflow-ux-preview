import { createFileRoute } from "@tanstack/react-router";
import {
  LegalDocument,
  LegalLink,
  PendingInformation,
  type LegalSection,
} from "@/components/legal/LegalDocument";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — PipeFlow CRM" },
      {
        name: "description",
        content:
          "Minuta dos Termos de Uso do PipeFlow CRM e da Prospecção B2B: acesso, responsabilidades e uso permitido dos dados.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: TermsPage,
});

const sections: LegalSection[] = [
  {
    id: "finalidade",
    title: "Finalidade e abrangência",
    content: (
      <>
        <p>
          O PipeFlow CRM é o projeto da Gravon Company destinado à organização de leads, funis
          comerciais, atendimentos e conversas. Estes termos tratam do uso do sistema e de sua
          Prospecção B2B, quando habilitada.
        </p>
        <p>
          A Prospecção B2B auxilia a localizar empresas por segmento e localidade, revisar
          informações empresariais, importar cadastros autorizados e preparar rascunhos de
          abordagem. Não oferece garantia de vendas, de interesse comercial dos destinatários ou de
          autorização para contatá-los.
        </p>
        <p>
          Responsável informado: <strong>Gravon Company Marketing LTDA</strong>, CNPJ{" "}
          <strong>41.988.192/0001-73</strong>. E-mail oficial:{" "}
          <LegalLink href="mailto:contato@gravoncompany.com">contato@gravoncompany.com</LegalLink>.
        </p>
        <PendingInformation>
          O CNPJ está transcrito exatamente como informado e possui dígitos verificadores válidos.
          Conferir o comprovante cadastral oficial antes da publicação. Confirmar também o endereço,
          as condições contratuais aplicáveis e a data de vigência da versão aprovada.
        </PendingInformation>
      </>
    ),
  },
  {
    id: "acesso",
    title: "Acesso e condições de utilização",
    content: (
      <>
        <p>
          O uso das áreas operacionais exige autenticação e as permissões correspondentes. A
          Prospecção B2B exige acesso completo ao CRM. A consulta pública destes documentos não
          concede acesso a leads, funis, conversas, Gravon IA ou aos recursos de busca.
        </p>
        <p>
          O usuário deve manter suas credenciais protegidas, utilizar apenas os acessos que lhe
          foram concedidos e comunicar ao responsável suspeitas de uso indevido. Não é permitido
          contornar verificações de acesso, restrições de consumo ou controles de segurança.
        </p>
      </>
    ),
  },
  {
    id: "uso-dados",
    title: "Uso permitido dos dados",
    content: (
      <>
        <p>
          As informações devem ser utilizadas para finalidades comerciais legítimas, específicas e
          compatíveis com sua origem, observando a legislação e os direitos dos titulares. Cabe ao
          usuário verificar a exatidão, a necessidade e a autorização para armazenar ou utilizar
          cada dado.
        </p>
        <ul>
          <li>
            A presença de um contato em fonte pública não equivale a consentimento para publicidade
            ou envio de mensagens.
          </li>
          <li>
            Não utilizar a ferramenta para spam, fraude, assédio, discriminação, coleta indevida de
            dados sensíveis ou divulgação não autorizada de informações.
          </li>
          <li>
            Respeitar pedidos de oposição ou de interrupção de contatos e os registros de bloqueio
            aplicáveis.
          </li>
          <li>
            Não remover atribuições de terceiros nem extrair, copiar, revender ou armazenar conteúdo
            de provedores fora das permissões legais e contratuais correspondentes.
          </li>
        </ul>
        <p>
          Uma confirmação na interface registra a revisão do usuário; não substitui a verificação da
          base legal ou os direitos de terceiros.
        </p>
      </>
    ),
  },
  {
    id: "google",
    title: "Google Places e outros provedores",
    content: (
      <>
        <p>
          O uso dos recursos do Google está sujeito aos{" "}
          <LegalLink href="https://policies.google.com/terms?hl=pt-BR">
            Termos de Serviço do Google
          </LegalLink>{" "}
          e aos{" "}
          <LegalLink href="https://www.google.com/intl/pt-BR/help/terms_maps/">
            Termos adicionais do Google Maps e Google Earth
          </LegalLink>
          , que integram estes Termos no que se refere a esses recursos. O tratamento de dados pelo
          Google segue sua{" "}
          <LegalLink href="https://policies.google.com/privacy?hl=pt-BR">
            Política de Privacidade
          </LegalLink>
          .
        </p>
        <p>
          Os resultados do Places são apresentados com as atribuições dos provedores. Seu conteúdo
          não deve ser convertido em uma base permanente de prospecção. O fluxo implementado
          preserva apenas o identificador do local, quando necessário, e exige fonte independente
          autorizada para os dados importados ao CRM.
        </p>
        <p>
          Informações obtidas manualmente ou por DeskData, quando disponível, também exigem revisão
          da origem e das condições de uso. A disponibilidade de uma integração não transfere ao
          usuário direitos sobre os dados que o fornecedor não tenha concedido.
        </p>
      </>
    ),
  },
  {
    id: "revisao",
    title: "Revisão, importação e contatos",
    content: (
      <>
        <p>
          Antes da importação, o usuário deve confirmar a identidade da empresa, revisar seus dados
          e indicar uma fonte que permita o armazenamento. A ferramenta possui controles para
          reduzir duplicidades, mas eles não asseguram que todo cadastro seja único ou correto.
        </p>
        <p>
          A busca e a importação B2B não enviam mensagens automaticamente. O módulo prepara
          rascunhos de e-mail e permite registrar endereços bloqueados; a marcação de um rascunho
          como revisado não significa envio. Qualquer abordagem posterior precisa respeitar as
          permissões, as escolhas dos destinatários e as regras do canal utilizado.
        </p>
        <p>
          A exclusão de um lead ou a limpeza de uma conversa no navegador não garante o apagamento
          de todos os registros relacionados nem de cópias mantidas por serviços externos. Pedidos
          de eliminação de dados pessoais devem ser encaminhados ao canal de privacidade para
          avaliação do alcance, dos vínculos técnicos e das hipóteses legais de conservação.
        </p>
        <p>
          As integrações e automações existentes de WhatsApp, Evolution API e Gravon IA seguem seus
          próprios controles. A disponibilização destas páginas não ativa, modifica ou autoriza
          essas operações.
        </p>
      </>
    ),
  },
  {
    id: "limites",
    title: "Limitações e responsabilidades",
    content: (
      <>
        <p>
          Os resultados podem estar incompletos, desatualizados ou divergir de outras fontes.
          Confirme informações relevantes antes de tomar decisões. Sugestões de IA e rascunhos
          exigem revisão humana.
        </p>
        <p>
          As consultas dependem da disponibilidade, das credenciais, das cotas e das condições dos
          provedores externos. Podem existir custos por consulta, inclusive quando uma tentativa não
          retorna o resultado esperado. A interface não substitui a conferência do consumo nos
          serviços contratados.
        </p>
        <p>
          O usuário responde pelo uso de suas permissões e pelas informações que insere ou utiliza.
          Essas condições não afastam responsabilidades legais do responsável pelo PipeFlow nem
          direitos que não possam ser limitados por contrato.
        </p>
        <PendingInformation>
          Confirmar com o responsável as condições comerciais, quem suporta os custos dos
          provedores, o canal de suporte e os procedimentos de suspensão e encerramento. Não são
          prometidos níveis de serviço ou disponibilidade nesta minuta.
        </PendingInformation>
      </>
    ),
  },
  {
    id: "privacidade-contato",
    title: "Privacidade, contato e versões",
    content: (
      <>
        <p>
          O tratamento de dados deve ser lido em conjunto com a{" "}
          <LegalLink href="/privacidade">Política de Privacidade do PipeFlow CRM</LegalLink>. O
          canal oficial da Gravon Company Marketing LTDA, inclusive para solicitações relacionadas à
          privacidade e à proteção de dados pessoais, é{" "}
          <LegalLink href="mailto:contato@gravoncompany.com">contato@gravoncompany.com</LegalLink>.
        </p>
        <PendingInformation>
          Concluir a conferência cadastral e a revisão jurídica antes de aprovar o texto final. Esta
          minuta não estabelece uma data de vigência nem implementa aceite contratual automático.
        </PendingInformation>
        <p>
          As versões aprovadas deverão apresentar a data de atualização. Eventuais alterações
          relevantes precisam ser comunicadas de modo adequado, respeitando os contratos e a
          legislação aplicáveis.
        </p>
      </>
    ),
  },
];

function TermsPage() {
  return (
    <LegalDocument
      kind="termos"
      title="Termos de Uso"
      description="Condições para usar o PipeFlow CRM e pesquisar empresas com responsabilidade, revisão humana e respeito à origem dos dados."
      sections={sections}
    />
  );
}
