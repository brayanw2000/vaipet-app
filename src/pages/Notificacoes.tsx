import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, MessageCircle, Tag, Megaphone, Mail, Smartphone, Moon } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { BottomNavigation } from '@/components/BottomNavigation';

const BRAND = '#31D880';

type Pref = {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  default: boolean;
};

const PREFS: Pref[] = [
  { id: 'walks', title: 'Passeios', description: 'Aceite, chegada e fim do passeio', icon: Bell, default: true },
  { id: 'chat', title: 'Mensagens', description: 'Novas mensagens do passeador', icon: MessageCircle, default: true },
  { id: 'promos', title: 'Promoções', description: 'Ofertas do marketplace e parceiros', icon: Tag, default: false },
  { id: 'news', title: 'Novidades VaiPet', description: 'Lançamentos e atualizações do app', icon: Megaphone, default: false },
  { id: 'email', title: 'E-mail', description: 'Recibos e resumos semanais', icon: Mail, default: true },
  { id: 'push', title: 'Push', description: 'Alertas em tempo real no celular', icon: Smartphone, default: true },
  { id: 'dnd', title: 'Não perturbe', description: 'Silenciar entre 22h e 7h', icon: Moon, default: false },
];

const Notificacoes: React.FC = () => {
  const navigate = useNavigate();
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;
  const [state, setState] = useState<Record<string, boolean>>(
    () => Object.fromEntries(PREFS.map((p) => [p.id, p.default]))
  );

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
            Alertas
          </span>
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: BRAND, color: '#0B1410' }}
          >
            <Bell className="w-4 h-4" strokeWidth={2.4} />
          </div>
        </div>

        <div className="px-5 pt-3 pb-6">
          <h1
            className="font-bold leading-[0.92]"
            style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(36px, 11vw, 46px)', letterSpacing: '-0.04em' }}
          >
            Notificações
          </h1>
          <p className="mt-3 text-[13px] max-w-[80%]" style={{ opacity: 0.6 }}>
            Escolha o que merece a sua atenção.
          </p>
        </div>

        <div className="px-5 space-y-2.5">
          {PREFS.map((p) => (
            <div
              key={p.id}
              className="w-full p-4 flex items-center justify-between"
              style={{ background: PAPER, border: `1px solid ${INK}1F`, borderRadius: 22 }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: state[p.id] ? BRAND : `${INK}0F`, color: state[p.id] ? '#0B1410' : INK }}
                >
                  <p.icon className="w-5 h-5" strokeWidth={2} />
                </div>
                <div className="text-left min-w-0">
                  <h3
                    className="font-bold leading-tight truncate"
                    style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15 }}
                  >
                    {p.title}
                  </h3>
                  <p className="text-[11px]" style={{ opacity: 0.6 }}>{p.description}</p>
                </div>
              </div>
              <Switch
                checked={state[p.id]}
                onCheckedChange={(v) => setState((s) => ({ ...s, [p.id]: v }))}
              />
            </div>
          ))}
        </div>
      </div>
      <BottomNavigation />
    </div>
  );
};

export default Notificacoes;