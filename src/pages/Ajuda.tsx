import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, HelpCircle, ChevronDown, MessageCircle, Mail, Phone, BookOpen, ArrowUpRight } from 'lucide-react';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { BottomNavigation } from '@/components/BottomNavigation';

const BRAND = '#31D880';

const FAQS = [
  { q: 'Como agendar um passeio?', a: 'Toque em "Iniciar passear agora" na home, escolha o pet, a duração e o tipo de passeio. Um passeador próximo será notificado.' },
  { q: 'Como funciona o pagamento?', a: 'O valor é calculado pela duração contratada do passeio. Recarregue sua carteira VaiPet para liberar passeios automáticos.' },
  { q: 'Posso cancelar um passeio?', a: 'Sim, sem custos enquanto nenhum passeador tiver aceitado. Após aceite, taxa simbólica pode ser aplicada.' },
  { q: 'Como cadastrar mais pets?', a: 'Em Perfil → Meus pets → "+ Adicionar". Sem limite de pets por conta.' },
  { q: 'O passeador está atrasado, e agora?', a: 'Acompanhe a chegada em tempo real no mapa. Em caso de problema, use o chat ou o suporte abaixo.' },
];

const CHANNELS = [
  { icon: MessageCircle, title: 'Chat com suporte', description: 'Resposta em até 5 minutos', href: '#' },
  { icon: Mail, title: 'ajuda@vaipet.app', description: 'E-mail oficial', href: 'mailto:ajuda@vaipet.app' },
  { icon: Phone, title: '0800 123 4567', description: 'Seg a sáb, 8h às 22h', href: 'tel:08001234567' },
  { icon: BookOpen, title: 'Central de ajuda', description: 'Artigos, guias e tutoriais', href: '#' },
];

const Ajuda: React.FC = () => {
  const navigate = useNavigate();
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div
      className="min-h-screen flex flex-col max-w-md mx-auto relative"
      style={{ background: PAPER, color: INK, fontFamily: 'DM Sans, sans-serif' }}
    >
      <div className="flex-1 pb-28">
        <div className="px-5 pt-6 pb-2 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            aria-label="Voltar"
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{ border: `1px solid ${INK}26`, color: INK }}
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2.2} />
          </button>
          <span className="text-[10px] font-bold uppercase tracking-[0.28em]" style={{ opacity: 0.55 }}>
            Suporte
          </span>
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: BRAND, color: '#0B1410' }}
          >
            <HelpCircle className="w-4 h-4" strokeWidth={2.4} />
          </div>
        </div>

        <div className="px-5 pt-3 pb-6">
          <h1
            className="font-bold leading-[0.92]"
            style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(36px, 11vw, 46px)', letterSpacing: '-0.04em' }}
          >
            Como podemos<br />ajudar?
          </h1>
          <p className="mt-3 text-[13px] max-w-[80%]" style={{ opacity: 0.6 }}>
            Respostas rápidas e canais diretos com o time VaiPet.
          </p>
        </div>

        <div className="px-5">
          <h2
            className="text-[10px] font-bold uppercase tracking-[0.28em] mb-3"
            style={{ opacity: 0.55 }}
          >
            Perguntas frequentes
          </h2>
          <div className="space-y-2.5">
            {FAQS.map((f, i) => {
              const isOpen = open === i;
              return (
                <button
                  key={i}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full p-4 text-left transition-all"
                  style={{ background: PAPER, border: `1px solid ${INK}1F`, borderRadius: 22 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3
                      className="font-bold leading-snug"
                      style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15 }}
                    >
                      {f.q}
                    </h3>
                    <ChevronDown
                      className="w-4 h-4 mt-0.5 shrink-0 transition-transform"
                      strokeWidth={2.4}
                      style={{ transform: isOpen ? 'rotate(180deg)' : 'none', opacity: 0.6 }}
                    />
                  </div>
                  {isOpen && (
                    <p className="mt-2 text-[13px] leading-relaxed" style={{ opacity: 0.7 }}>
                      {f.a}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          <h2
            className="text-[10px] font-bold uppercase tracking-[0.28em] mt-7 mb-3"
            style={{ opacity: 0.55 }}
          >
            Fale com a gente
          </h2>
          <div className="space-y-2.5">
            {CHANNELS.map((c, i) => (
              <a
                key={i}
                href={c.href}
                className="w-full p-4 flex items-center justify-between active:scale-[0.99] transition-transform"
                style={{ background: PAPER, border: `1px solid ${INK}1F`, borderRadius: 22 }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${INK}0F`, color: INK }}>
                    <c.icon className="w-5 h-5" strokeWidth={2} />
                  </div>
                  <div className="text-left min-w-0">
                    <h3 className="font-bold leading-tight truncate" style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15 }}>
                      {c.title}
                    </h3>
                    <p className="text-[11px]" style={{ opacity: 0.6 }}>{c.description}</p>
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4" style={{ opacity: 0.45 }} strokeWidth={2.4} />
              </a>
            ))}
          </div>
        </div>
      </div>
      <BottomNavigation />
    </div>
  );
};

export default Ajuda;