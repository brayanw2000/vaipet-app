import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TermsOfUse = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
      <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 z-10">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-bold" style={{ color: '#0B1410' }}>Termos de Uso</h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6 text-sm text-gray-700 leading-relaxed">
        <p className="text-xs text-gray-400">Última atualização: 11 de fevereiro de 2026</p>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>1. Aceitação dos Termos</h2>
          <p>Ao acessar ou utilizar o aplicativo VaiPet ("Plataforma"), você declara que leu, compreendeu e concorda com estes Termos de Uso. Se você não concordar com qualquer parte destes termos, não utilize a plataforma.</p>
          <p>Estes Termos constituem um contrato vinculante entre você ("Usuário") e a VaiPet Tecnologia Ltda. ("VaiPet", "nós" ou "nosso"), empresa inscrita no CNPJ sob nº XX.XXX.XXX/0001-XX, com sede em São Paulo/SP.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>2. Descrição dos Serviços</h2>
          <p>A VaiPet é uma plataforma digital que conecta tutores de animais de estimação a prestadores de serviços pet, incluindo:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Passeios (Dog Walking):</strong> Serviço de passeio monitorado com rastreamento GPS em tempo real</li>
            <li><strong>Petshop:</strong> Marketplace de produtos para pets oferecidos por petshops parceiros</li>
            <li><strong>Hotelaria Pet:</strong> Reserva de hospedagem para animais de estimação</li>
            <li><strong>Veterinário:</strong> Agendamento de consultas e serviços veterinários</li>
            <li><strong>Rede Pet:</strong> Rede social para tutores compartilharem experiências e fotos dos seus pets</li>
          </ul>
          <p>A VaiPet atua como intermediadora entre tutores e prestadores de serviço, não sendo responsável direta pela execução dos serviços prestados por terceiros.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>3. Cadastro e Conta</h2>
          <p><strong>3.1</strong> Para utilizar os serviços da VaiPet, é necessário criar uma conta fornecendo informações verdadeiras, completas e atualizadas.</p>
          <p><strong>3.2</strong> Você é responsável por manter a confidencialidade de suas credenciais de acesso (e-mail e senha) e por todas as atividades realizadas em sua conta.</p>
          <p><strong>3.3</strong> Cada usuário pode possuir apenas uma conta ativa na plataforma.</p>
          <p><strong>3.4</strong> Você deve ter no mínimo 18 anos de idade para criar uma conta.</p>
          <p><strong>3.5</strong> Ao cadastrar seus pets, você declara ser o tutor legal ou responsável autorizado pelo animal.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>4. Obrigações do Usuário</h2>
          <p>Ao utilizar a plataforma, você se compromete a:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Fornecer informações verdadeiras e atualizadas sobre você e seus pets</li>
            <li>Informar corretamente o temperamento, condições de saúde e necessidades especiais dos seus animais</li>
            <li>Manter a vacinação e documentação dos seus pets atualizadas</li>
            <li>Tratar com respeito e cordialidade os prestadores de serviço e demais usuários</li>
            <li>Não utilizar a plataforma para fins ilícitos, fraudulentos ou que violem a legislação brasileira</li>
            <li>Não publicar conteúdo ofensivo, discriminatório, violento ou que viole direitos de terceiros na Rede Pet</li>
            <li>Não tentar acessar áreas restritas da plataforma ou interferir em seu funcionamento</li>
            <li>Comunicar imediatamente qualquer uso não autorizado da sua conta</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>5. Serviço de Passeio</h2>
          <p><strong>5.1</strong> O serviço de passeio é prestado por dog walkers independentes cadastrados e verificados pela plataforma.</p>
          <p><strong>5.2</strong> O tutor deve informar corretamente o comportamento e necessidades do animal antes de cada passeio.</p>
          <p><strong>5.3</strong> O rastreamento GPS é fornecido para acompanhamento em tempo real do passeio.</p>
          <p><strong>5.4</strong> A VaiPet não se responsabiliza por incidentes decorrentes de informações incorretas fornecidas pelo tutor sobre o comportamento do animal.</p>
          <p><strong>5.5</strong> Cancelamentos devem ser realizados com antecedência mínima de 2 horas. Cancelamentos tardios podem estar sujeitos a cobrança.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>6. Marketplace (Petshop)</h2>
          <p><strong>6.1</strong> Os produtos disponíveis no marketplace são oferecidos por petshops parceiros independentes.</p>
          <p><strong>6.2</strong> A VaiPet atua como intermediadora e não é responsável pela qualidade, entrega ou garantia dos produtos.</p>
          <p><strong>6.3</strong> Reclamações sobre produtos devem ser direcionadas ao petshop vendedor, podendo a VaiPet intermediar a resolução.</p>
          <p><strong>6.4</strong> Preços, disponibilidade e promoções são de responsabilidade exclusiva dos petshops parceiros.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>7. Pagamentos</h2>
          <p><strong>7.1</strong> Os pagamentos são processados por meio de parceiros de pagamento homologados.</p>
          <p><strong>7.2</strong> Os preços dos serviços incluem a taxa de intermediação da VaiPet.</p>
          <p><strong>7.3</strong> Reembolsos seguem a política específica de cada serviço e estão sujeitos a análise.</p>
          <p><strong>7.4</strong> A VaiPet se reserva o direito de alterar os preços de seus serviços mediante aviso prévio aos usuários.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>8. Conteúdo do Usuário (Rede Pet)</h2>
          <p><strong>8.1</strong> Ao publicar conteúdo na Rede Pet, você concede à VaiPet uma licença não exclusiva, gratuita e mundial para exibir, reproduzir e distribuir tal conteúdo dentro da plataforma.</p>
          <p><strong>8.2</strong> Você é responsável por todo conteúdo publicado e garante que possui os direitos necessários sobre ele.</p>
          <p><strong>8.3</strong> A VaiPet se reserva o direito de remover conteúdo que viole estes Termos, sem aviso prévio.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>9. Propriedade Intelectual</h2>
          <p>Todo o conteúdo da plataforma VaiPet, incluindo mas não limitado a logotipos, marcas, textos, imagens, design, código-fonte e software, são de propriedade exclusiva da VaiPet ou de seus licenciadores e estão protegidos pelas leis brasileiras de propriedade intelectual.</p>
          <p>É proibida a reprodução, distribuição, modificação ou uso não autorizado de qualquer conteúdo da plataforma.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>10. Limitação de Responsabilidade</h2>
          <p><strong>10.1</strong> A VaiPet não se responsabiliza por danos diretos, indiretos, incidentais ou consequentes decorrentes do uso ou impossibilidade de uso da plataforma.</p>
          <p><strong>10.2</strong> A VaiPet não garante a disponibilidade ininterrupta da plataforma, podendo haver períodos de manutenção ou indisponibilidade.</p>
          <p><strong>10.3</strong> A responsabilidade da VaiPet está limitada ao valor pago pelo serviço específico que gerou a reclamação.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>11. Suspensão e Encerramento</h2>
          <p><strong>11.1</strong> A VaiPet se reserva o direito de suspender ou encerrar sua conta, a seu critério exclusivo, em caso de violação destes Termos.</p>
          <p><strong>11.2</strong> Você pode encerrar sua conta a qualquer momento através das configurações do aplicativo.</p>
          <p><strong>11.3</strong> O encerramento da conta não exime o usuário de obrigações financeiras pendentes.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>12. Bem-Estar Animal</h2>
          <p>A VaiPet é comprometida com o bem-estar animal. Qualquer evidência de maus-tratos, negligência ou tratamento inadequado aos animais resultará na suspensão imediata da conta e poderá ser reportada às autoridades competentes, em conformidade com a Lei Federal nº 9.605/1998 (Lei de Crimes Ambientais).</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>13. Legislação Aplicável e Foro</h2>
          <p>Estes Termos são regidos pela legislação brasileira. Para resolução de quaisquer controvérsias, fica eleito o foro da comarca de São Paulo/SP, com renúncia expressa a qualquer outro, por mais privilegiado que seja.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>14. Alterações nos Termos</h2>
          <p>A VaiPet se reserva o direito de modificar estes Termos a qualquer momento. Alterações significativas serão comunicadas com antecedência de 30 dias. O uso continuado da plataforma após as alterações constitui aceitação dos novos termos.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold" style={{ color: '#0B1410' }}>15. Contato</h2>
          <p>Para dúvidas sobre estes Termos de Uso, entre em contato:</p>
          <ul className="list-none space-y-1">
            <li><strong>E-mail:</strong> contato@vaipet.com.br</li>
            <li><strong>SAC:</strong> sac@vaipet.com.br</li>
          </ul>
        </section>

        <div className="pt-8 pb-12 text-center text-xs text-gray-400">
          © 2026 VaiPet. Todos os direitos reservados.
        </div>
      </div>
    </div>
  );
};

export default TermsOfUse;
