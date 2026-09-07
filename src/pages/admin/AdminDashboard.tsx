
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, 
  ChevronRight, 
  LayoutDashboard, 
  ShieldCheck,
  ArrowLeft
} from 'lucide-react';
import { useHomeTheme } from '@/hooks/useHomeTheme';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;

  const menuItems = [
    {
      title: 'Candidaturas PetWalker',
      description: 'Analisar e aprovar novos parceiros',
      icon: Users,
      path: '/admin/petwalkers',
      color: '#31D880'
    }
  ];

  return (
    <div 
      className="min-h-screen flex flex-col max-w-md mx-auto"
      style={{ background: PAPER, color: INK, fontFamily: 'DM Sans, sans-serif' }}
    >
      <div className="px-5 pt-8 pb-4 flex items-center gap-4">
        <button
          onClick={() => navigate('/configuracoes')}
          className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
          style={{ border: `1px solid ${INK}26` }}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Painel Administrativo
        </h1>
      </div>

      <div className="flex-1 px-5 pt-4 space-y-6">
        <div 
          className="p-6 rounded-[32px] space-y-1"
          style={{ background: `${INK}08`, border: `1px solid ${INK}14` }}
        >
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-5 h-5 text-[#31D880]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">Admin Ativo</span>
          </div>
          <h2 className="text-2xl font-bold leading-tight" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            Olá, Administrador
          </h2>
          <p className="text-sm opacity-60">Gerencie a plataforma e aprove novos membros da comunidade.</p>
        </div>

        <div className="grid gap-3">
          {menuItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="w-full p-5 flex items-center justify-between rounded-[28px] active:scale-[0.98] transition-all text-left"
              style={{ background: PAPER, border: `1px solid ${INK}14` }}
            >
              <div className="flex items-center gap-4">
                <div 
                  className="w-12 h-12 rounded-2xl flex items-center justify-center"
                  style={{ background: `${item.color}15`, color: item.color }}
                >
                  <item.icon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                    {item.title}
                  </h3>
                  <p className="text-xs opacity-60">{item.description}</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 opacity-30" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
