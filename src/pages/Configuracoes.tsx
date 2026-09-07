import React, { useEffect, useState } from 'react';
import { BottomNavigation } from '@/components/BottomNavigation';
import {
  User,
  Bell,
  Shield,
  HelpCircle,
  LogOut,
  ArrowUpRight,
  Fingerprint,
  Clock,
  ShieldCheck,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Wallet,
  CreditCard,
  Receipt,
  MapPin,
  PawPrint,
  Languages,
  Phone,
  MessageCircle,
  Mail,
  Info,
  FileText,
  Star,
  Share2,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Switch } from '@/components/ui/switch';
import { biometric, prefs, isNative, haptic } from '@/lib/native';
import { toast } from 'sonner';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from '@/integrations/supabase/client';

const BRAND = '#31D880';
const DANGER = '#E5484D';

const BIO_LOCK_KEY = 'vaipet.bioLock';

const Configuracoes = () => {
  const { signOut, refreshProfile, roles } = useAuth();
  const navigate = useNavigate();
  const { theme, toggle, palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [showPetwalkerDialog, setShowPetwalkerDialog] = useState(false);
  const [isUpdatingIntent, setIsUpdatingIntent] = useState(false);

  useEffect(() => {
    (async () => {
      const available = await biometric.isAvailable();
      setBioAvailable(available);
      const saved = await prefs.get<boolean>(BIO_LOCK_KEY);
      setBioEnabled(!!saved);
    })();
  }, []);

  const toggleBio = async (next: boolean) => {
    haptic.selection();
    if (next) {
      const ok = await biometric.authenticate('Ative o bloqueio biométrico');
      if (!ok) {
        toast.error('Não foi possível autenticar');
        return;
      }
    }
    await prefs.set(BIO_LOCK_KEY, next);
    setBioEnabled(next);
    toast.success(next ? 'Bloqueio biométrico ativado' : 'Bloqueio biométrico desativado');
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/auth');
  };

  const handlePetwalkerClick = () => {
    setShowPetwalkerDialog(true);
  };

  const confirmPetwalkerIntent = async () => {
    setIsUpdatingIntent(true);
    try {
      const { error } = await supabase.rpc('set_signup_intent', { _intent: 'petwalker' });
      if (error) throw error;
      
      await refreshProfile();
      setShowPetwalkerDialog(false);
      navigate('/petwalker/inscricao');
    } catch (err) {
      console.error('Error setting intent:', err);
      toast.error('Erro ao atualizar seu perfil');
    } finally {
      setIsUpdatingIntent(false);
    }
  };

  type Item = {
    icon: React.ElementType;
    title: string;
    description: string;
    onClick: () => void;
    badge?: string;
  };

  const soon = () => toast('Disponível em breve');

  const sections: { label: string; items: Item[] }[] = [
    {
      label: 'Conta',
      items: [
        { icon: User, title: 'Perfil', description: 'Editar informações pessoais', onClick: () => navigate('/perfil') },
        ...(roles.includes('admin') ? [{ 
          icon: ShieldCheck, 
          title: 'Painel administrativo', 
          description: 'Gestão da plataforma', 
          onClick: () => navigate('/admin') 
        }] : []),
        { icon: Star, title: 'Quero ser PetWalker', description: 'Trabalhe passeando com pets', onClick: handlePetwalkerClick },
        { icon: PawPrint, title: 'Meus pets', description: 'Cadastros e saúde', onClick: () => navigate('/add-pet') },
        { icon: MapPin, title: 'Endereços', description: 'Casa, trabalho e outros', onClick: soon },
      ],
    },
    {
      label: 'Pagamentos',
      items: [
        { icon: Wallet, title: 'Carteira VaiPet', description: 'Saldo, recargas e cashback', onClick: soon, badge: 'R$ 0,00' },
        { icon: CreditCard, title: 'Formas de pagamento', description: 'Cartões e Pix salvos', onClick: soon },
        { icon: Receipt, title: 'Faturas e recibos', description: 'Histórico de cobranças', onClick: soon },
      ],
    },
    {
      label: 'Atividade',
      items: [
        { icon: Clock, title: 'Histórico de passeios', description: 'Todos os passeios concluídos', onClick: () => navigate('/historico') },
        { icon: Star, title: 'Avaliações', description: 'O que você avaliou', onClick: soon },
      ],
    },
    {
      label: 'Preferências',
      items: [
        { icon: Bell, title: 'Notificações', description: 'Push, e-mail e silenciar', onClick: () => navigate('/notificacoes') },
        { icon: Shield, title: 'Privacidade', description: 'Dados, LGPD e exclusão', onClick: () => navigate('/privacidade') },
        { icon: Languages, title: 'Idioma', description: 'Português (Brasil)', onClick: soon },
      ],
    },
    {
      label: 'Suporte',
      items: [
        { icon: MessageCircle, title: 'Chat com suporte', description: 'Resposta em até 5 min', onClick: () => navigate('/ajuda') },
        { icon: Phone, title: 'Ligar para o suporte', description: '0800 123 4567 · seg–sáb 8–22h', onClick: () => { window.location.href = 'tel:08001234567'; } },
        { icon: Mail, title: 'ajuda@vaipet.app', description: 'Resposta por e-mail', onClick: () => { window.location.href = 'mailto:ajuda@vaipet.app'; } },
        { icon: HelpCircle, title: 'Central de ajuda', description: 'Perguntas frequentes', onClick: () => navigate('/ajuda') },
      ],
    },
    {
      label: 'Sobre',
      items: [
        { icon: Share2, title: 'Indique e ganhe', description: 'Convide amigos e ganhe créditos', onClick: soon },
        { icon: FileText, title: 'Termos de uso', description: 'Última atualização 2026', onClick: () => navigate('/termos-de-uso') },
        { icon: Shield, title: 'Política de privacidade', description: 'LGPD e tratamento de dados', onClick: () => navigate('/politica-de-privacidade') },
        { icon: Info, title: 'Sobre o VaiPet', description: 'Versão 2.0.0', onClick: soon },
      ],
    },
  ];

  return (
    <div
      className="min-h-screen flex flex-col max-w-md mx-auto relative"
      style={{ background: PAPER, color: INK, fontFamily: 'DM Sans, sans-serif' }}
    >
      <div className="flex-1 pb-28">
        {/* Top bar */}
        <div className="px-5 pt-6 pb-2 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            aria-label="Voltar"
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{ border: `1px solid ${INK}26`, color: INK }}
          >
            <SettingsIcon className="w-4 h-4" strokeWidth={2.2} />
          </button>
          <span
            className="text-[10px] font-bold uppercase tracking-[0.28em]"
            style={{ opacity: 0.55 }}
          >
            Conta
          </span>
          <button
            onClick={toggle}
            aria-label="Alternar tema"
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{ border: `1px solid ${INK}26`, color: INK }}
          >
            {theme === 'light' ? (
              <Moon className="w-4 h-4" strokeWidth={2.2} />
            ) : (
              <Sun className="w-4 h-4" strokeWidth={2.2} />
            )}
          </button>
        </div>

        {/* Headline */}
        <div className="px-5 pt-3 pb-6">
          <h1
            className="font-bold leading-[0.92]"
            style={{
              fontFamily: 'Space Grotesk, sans-serif',
              fontSize: 'clamp(36px, 11vw, 46px)',
              letterSpacing: '-0.04em',
            }}
          >
            Ajustes
          </h1>
          <p className="mt-3 text-[13px] max-w-[80%]" style={{ opacity: 0.6 }}>
            Tudo no seu jeito.
          </p>
        </div>

        <div className="px-5">
          {/* Bloqueio biométrico */}
          {isNative() && bioAvailable && (
            <div
              className="w-full p-4 flex items-center justify-between"
              style={{
                background: PAPER,
                border: `1px solid ${INK}1F`,
                borderRadius: 22,
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center"
                  style={{ background: BRAND, color: '#0B1410' }}
                >
                  <Fingerprint className="w-5 h-5" strokeWidth={2.2} />
                </div>
                <div className="text-left">
                  <h3
                    className="font-bold leading-tight"
                    style={{
                      fontFamily: 'Space Grotesk, sans-serif',
                      fontSize: 15,
                    }}
                  >
                    Bloqueio biométrico
                  </h3>
                  <p className="text-[11px]" style={{ opacity: 0.6 }}>
                    Face ID / Touch ID ao abrir
                  </p>
                </div>
              </div>
              <Switch checked={bioEnabled} onCheckedChange={toggleBio} />
            </div>
          )}

          {sections.map((section) => (
            <div key={section.label} className="mt-6 first:mt-3">
              <h2
                className="text-[10px] font-bold uppercase tracking-[0.28em] mb-3 pl-1"
                style={{ opacity: 0.55 }}
              >
                {section.label}
              </h2>
              <div
                className="overflow-hidden"
                style={{ background: PAPER, border: `1px solid ${INK}1F`, borderRadius: 22 }}
              >
                {section.items.map((item, i) => (
                  <button
                    key={item.title}
                    onClick={item.onClick}
                    className="w-full p-4 flex items-center justify-between active:bg-black/[0.03] transition-colors"
                    style={{
                      borderTop: i === 0 ? 'none' : `1px solid ${INK}14`,
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                        style={{ background: `${INK}0F`, color: INK }}
                      >
                        <item.icon className="w-5 h-5" strokeWidth={2} />
                      </div>
                      <div className="text-left min-w-0">
                        <h3
                          className="font-bold leading-tight truncate"
                          style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15 }}
                        >
                          {item.title}
                        </h3>
                        <p className="text-[11px] truncate" style={{ opacity: 0.6 }}>
                          {item.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.badge && (
                        <span
                          className="text-[10px] font-bold uppercase tracking-[0.15em] px-2 py-1 rounded-full"
                          style={{ background: BRAND, color: '#0B1410' }}
                        >
                          {item.badge}
                        </span>
                      )}
                      <ChevronRight className="w-4 h-4" style={{ opacity: 0.4 }} strokeWidth={2.4} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full p-4 flex items-center justify-between active:scale-[0.99] transition-transform mt-4"
            style={{
              background: 'transparent',
              border: `1px solid ${DANGER}55`,
              borderRadius: 22,
              color: DANGER,
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-2xl flex items-center justify-center"
                style={{ background: `${DANGER}1A`, color: DANGER }}
              >
                <LogOut className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div className="text-left">
                <h3
                  className="font-bold leading-tight"
                  style={{
                    fontFamily: 'Space Grotesk, sans-serif',
                    fontSize: 15,
                  }}
                >
                  Sair
                </h3>
                <p className="text-[11px]" style={{ opacity: 0.75 }}>
                  Encerrar sessão
                </p>
              </div>
            </div>
            <ArrowUpRight className="w-4 h-4" strokeWidth={2.4} />
          </button>
        </div>
      </div>

      <Dialog open={showPetwalkerDialog} onOpenChange={setShowPetwalkerDialog}>
        <DialogContent className="rounded-3xl max-w-[90vw] sm:max-w-md border-none p-8" style={{ background: PAPER, color: INK }}>
          <DialogHeader className="gap-2">
            <DialogTitle className="text-2xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              Quer se tornar PetWalker?
            </DialogTitle>
            <DialogDescription className="text-[15px] leading-relaxed" style={{ color: INK, opacity: 0.7 }}>
              Você precisará preencher uma candidatura, ter 18 anos ou mais e aguardar a análise da equipe VaiPet.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col sm:flex-col gap-3 mt-4">
            <Button 
              onClick={confirmPetwalkerIntent} 
              disabled={isUpdatingIntent}
              className="h-14 rounded-2xl font-bold text-lg w-full"
              style={{ background: BRAND, color: '#0B1410' }}
            >
              {isUpdatingIntent ? 'Aguarde...' : 'Iniciar candidatura'}
            </Button>
            <Button 
              variant="ghost" 
              onClick={() => setShowPetwalkerDialog(false)}
              className="h-14 rounded-2xl font-bold opacity-60 hover:opacity-100"
            >
              Agora não
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BottomNavigation />
    </div>
  );
};

export default Configuracoes;