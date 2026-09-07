import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Shield, MapPin, Eye, BarChart3, Cookie, Download, Trash2, ExternalLink } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { BottomNavigation } from '@/components/BottomNavigation';
import { toast } from 'sonner';

const BRAND = '#31D880';
const DANGER = '#E5484D';

const TOGGLES = [
  { id: 'location', title: 'Localização em tempo real', description: 'Necessária durante passeios ativos', icon: MapPin, default: true },
  { id: 'profile', title: 'Perfil visível para passeadores', description: 'Nome e foto aparecem ao buscar', icon: Eye, default: true },
  { id: 'analytics', title: 'Métricas anônimas', description: 'Ajuda a melhorar a experiência', icon: BarChart3, default: true },
  { id: 'cookies', title: 'Cookies opcionais', description: 'Personalização e recomendações', icon: Cookie, default: false },
] as const;

const Privacidade: React.FC = () => {
  const navigate = useNavigate();
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;
  const [state, setState] = useState<Record<string, boolean>>(
    () => Object.fromEntries(TOGGLES.map((t) => [t.id, t.default]))
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
            Seus dados
          </span>
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: BRAND, color: '#0B1410' }}
          >
            <Shield className="w-4 h-4" strokeWidth={2.4} />
          </div>
        </div>

        <div className="px-5 pt-3 pb-6">
          <h1
            className="font-bold leading-[0.92]"
            style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(36px, 11vw, 46px)', letterSpacing: '-0.04em' }}
          >
            Privacidade
          </h1>
          <p className="mt-3 text-[13px] max-w-[85%]" style={{ opacity: 0.6 }}>
            Esta página é mantida pela VaiPet para responder às perguntas mais comuns sobre seus dados. Você controla o que compartilhar.
          </p>
        </div>

        <div className="px-5 space-y-2.5">
          {TOGGLES.map((t) => (
            <div
              key={t.id}
              className="w-full p-4 flex items-center justify-between"
              style={{ background: PAPER, border: `1px solid ${INK}1F`, borderRadius: 22 }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: state[t.id] ? BRAND : `${INK}0F`, color: state[t.id] ? '#0B1410' : INK }}
                >
                  <t.icon className="w-5 h-5" strokeWidth={2} />
                </div>
                <div className="text-left min-w-0">
                  <h3
                    className="font-bold leading-tight truncate"
                    style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15 }}
                  >
                    {t.title}
                  </h3>
                  <p className="text-[11px]" style={{ opacity: 0.6 }}>{t.description}</p>
                </div>
              </div>
              <Switch
                checked={state[t.id]}
                onCheckedChange={(v) => setState((s) => ({ ...s, [t.id]: v }))}
              />
            </div>
          ))}

          <button
            onClick={() => toast.success('Solicitação registrada — enviaremos por e-mail')}
            className="w-full p-4 flex items-center justify-between active:scale-[0.99] transition-transform"
            style={{ background: PAPER, border: `1px solid ${INK}1F`, borderRadius: 22 }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: `${INK}0F`, color: INK }}>
                <Download className="w-5 h-5" strokeWidth={2} />
              </div>
              <div className="text-left">
                <h3 className="font-bold leading-tight" style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15 }}>
                  Baixar meus dados
                </h3>
                <p className="text-[11px]" style={{ opacity: 0.6 }}>Exportar histórico, pets e perfil</p>
              </div>
            </div>
          </button>

          <Link
            to="/politica-de-privacidade"
            className="w-full p-4 flex items-center justify-between active:scale-[0.99] transition-transform"
            style={{ background: PAPER, border: `1px solid ${INK}1F`, borderRadius: 22 }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: `${INK}0F`, color: INK }}>
                <ExternalLink className="w-5 h-5" strokeWidth={2} />
              </div>
              <div className="text-left">
                <h3 className="font-bold leading-tight" style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15 }}>
                  Política de Privacidade
                </h3>
                <p className="text-[11px]" style={{ opacity: 0.6 }}>Como tratamos seus dados (LGPD)</p>
              </div>
            </div>
          </Link>

          <button
            onClick={() => toast.error('Para excluir a conta, fale com o suporte em ajuda@vaipet.app')}
            className="w-full p-4 flex items-center justify-between active:scale-[0.99] transition-transform mt-4"
            style={{ background: 'transparent', border: `1px solid ${DANGER}55`, borderRadius: 22, color: DANGER }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: `${DANGER}1A`, color: DANGER }}>
                <Trash2 className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div className="text-left">
                <h3 className="font-bold leading-tight" style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15 }}>
                  Excluir conta
                </h3>
                <p className="text-[11px]" style={{ opacity: 0.75 }}>Remove permanentemente seus dados</p>
              </div>
            </div>
          </button>
        </div>
      </div>
      <BottomNavigation />
    </div>
  );
};

export default Privacidade;