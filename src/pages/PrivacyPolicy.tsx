import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PrivacyPolicy = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
      <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 z-10">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-bold" style={{ color: '#0B1410' }}>Política de Privacidade</h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6 text-sm text-gray-700 leading-relaxed">
        <p className="text-xs text-gray-400">Última atualização: 11 de fevereiro de 2026</p>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>1. Introdução</h2>
          <p>A VaiPet ("nós", "nosso" ou "plataforma") valoriza a privacidade dos seus usuários. Esta Política de Privacidade descreve como coletamos, usamos, armazenamos e protegemos suas informações pessoais quando você utiliza nosso aplicativo e serviços relacionados.</p>
          <p>Ao utilizar a plataforma VaiPet, você concorda com as práticas descritas nesta Política. Caso não concorde, recomendamos que não utilize nossos serviços.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>2. Informações que Coletamos</h2>
          <p><strong>2.1 Dados fornecidos por você:</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Nome completo e e-mail de cadastro</li>
            <li>Número de telefone celular</li>
            <li>Foto de perfil (avatar)</li>
            <li>Endereço e localização aproximada</li>
            <li>Dados dos seus pets: nome, raça, idade, peso, temperamento, informações médicas, fotos e contato de emergência</li>
            <li>Documentos veterinários enviados à plataforma</li>
          </ul>
          <p><strong>2.2 Dados coletados automaticamente:</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Dados de geolocalização durante sessões de passeio</li>
            <li>Informações sobre o dispositivo utilizado (modelo, sistema operacional, versão do navegador)</li>
            <li>Registros de acesso e navegação dentro do aplicativo</li>
            <li>Endereço IP e cookies de sessão</li>
          </ul>
          <p><strong>2.3 Dados de terceiros:</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Quando você opta por login social (Google ou Apple), recebemos seu nome, e-mail e foto de perfil conforme permitido pelo provedor</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>3. Como Usamos suas Informações</h2>
          <p>Utilizamos os dados coletados para:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Criar e gerenciar sua conta na plataforma</li>
            <li>Conectar você a serviços de passeio, petshop, hotelaria e veterinário</li>
            <li>Exibir informações relevantes sobre seus pets para prestadores de serviço</li>
            <li>Rastrear passeios em tempo real para sua segurança e do seu pet</li>
            <li>Processar pagamentos e gerenciar transações financeiras</li>
            <li>Enviar notificações relevantes sobre serviços contratados</li>
            <li>Melhorar a experiência do usuário e personalizar o conteúdo exibido</li>
            <li>Cumprir obrigações legais e regulatórias</li>
            <li>Prevenir fraudes e garantir a segurança da plataforma</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>4. Compartilhamento de Dados</h2>
          <p>Suas informações poderão ser compartilhadas com:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Prestadores de serviço:</strong> Dog walkers, petshops, hotéis e veterinários cadastrados na plataforma, apenas as informações necessárias para a prestação do serviço contratado</li>
            <li><strong>Parceiros tecnológicos:</strong> Provedores de infraestrutura, armazenamento em nuvem e processamento de pagamentos, sob contratos de confidencialidade</li>
            <li><strong>Autoridades legais:</strong> Quando exigido por lei, ordem judicial ou regulamentação aplicável</li>
          </ul>
          <p>Não vendemos, alugamos ou compartilhamos seus dados pessoais com terceiros para fins de marketing sem seu consentimento explícito.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>5. Armazenamento e Segurança</h2>
          <p>Seus dados são armazenados em servidores seguros com criptografia de ponta a ponta. Implementamos medidas técnicas e organizacionais apropriadas para proteger suas informações contra acesso não autorizado, alteração, divulgação ou destruição, incluindo:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Criptografia SSL/TLS em todas as transmissões de dados</li>
            <li>Autenticação de dois fatores disponível para sua conta</li>
            <li>Controle de acesso baseado em funções para nossos colaboradores</li>
            <li>Backups regulares e planos de recuperação de desastres</li>
            <li>Monitoramento contínuo contra ameaças de segurança</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>6. Seus Direitos (LGPD)</h2>
          <p>Em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você tem direito a:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Confirmar a existência de tratamento de seus dados pessoais</li>
            <li>Acessar seus dados pessoais armazenados</li>
            <li>Corrigir dados incompletos, inexatos ou desatualizados</li>
            <li>Solicitar a anonimização, bloqueio ou eliminação de dados desnecessários</li>
            <li>Solicitar a portabilidade dos dados a outro fornecedor de serviço</li>
            <li>Revogar o consentimento a qualquer momento</li>
            <li>Obter informações sobre entidades públicas e privadas com as quais compartilhamos seus dados</li>
          </ul>
          <p>Para exercer seus direitos, entre em contato conosco pelo e-mail: <strong>privacidade@vaipet.com.br</strong></p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>7. Cookies e Tecnologias de Rastreamento</h2>
          <p>Utilizamos cookies e tecnologias semelhantes para melhorar a funcionalidade da plataforma, lembrar suas preferências e analisar o uso do aplicativo. Você pode configurar seu navegador para recusar cookies, mas isso pode afetar a funcionalidade de alguns recursos.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>8. Retenção de Dados</h2>
          <p>Manteremos seus dados pessoais pelo tempo necessário para cumprir as finalidades para as quais foram coletados, incluindo obrigações legais, contratuais e regulatórias. Após o encerramento da sua conta, seus dados serão retidos por até 5 anos para fins legais e depois serão anonimizados ou excluídos.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>9. Menores de Idade</h2>
          <p>A VaiPet não é destinada a menores de 18 anos. Não coletamos intencionalmente dados de menores de idade. Caso tomemos conhecimento de que coletamos dados de um menor, tomaremos medidas para excluí-los imediatamente.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>10. Alterações nesta Política</h2>
          <p>Podemos atualizar esta Política de Privacidade periodicamente. Notificaremos você sobre quaisquer alterações significativas por meio do aplicativo ou por e-mail. Recomendamos que revise esta página regularmente.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>11. Contato</h2>
          <p>Para dúvidas ou solicitações relacionadas à privacidade, entre em contato:</p>
          <ul className="list-none space-y-1">
            <li><strong>E-mail:</strong> privacidade@vaipet.com.br</li>
            <li><strong>Encarregado de Dados (DPO):</strong> dpo@vaipet.com.br</li>
          </ul>
        </section>

        <div className="pt-8 pb-12 text-center text-xs text-gray-400">
          © 2026 VaiPet. Todos os direitos reservados.
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
