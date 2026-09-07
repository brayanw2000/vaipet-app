import React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { NotificationSheet } from '@/components/NotificationSheet';
import logoAsset from "@/assets/vaipet-logo-new.png.asset.json";

export const Header = () => {
  const { user, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isHomePage = location.pathname === '/';

  if (!isHomePage) return null;

  const getUserInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || profile?.full_name?.split(' ')[0] || 'Usuário';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <header className="px-5 pt-8 pb-2">
      {/* Top row: greeting + avatar + bell */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex flex-col gap-1">
          <img src="/vaipet-logo.svg" alt="VaiPet" className="w-24 h-auto mb-1" />
          <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider opacity-60">{greeting} {firstName}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <NotificationSheet />
          <button
            onClick={() => navigate('/profile')}
            className="w-10 h-10 rounded-full overflow-hidden bg-secondary border border-border/60 cursor-pointer active:scale-95 transition-transform"
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs font-bold text-foreground">
                {user?.user_metadata?.full_name ? getUserInitials(user.user_metadata.full_name) : 'U'}
              </div>
            )}
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-2">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" strokeWidth={2} />
        <input
          type="text"
          placeholder="Buscar serviços, pets..."
          className="w-full h-11 rounded-full bg-card border border-border/60 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all"
        />
      </div>
    </header>
  );
};
