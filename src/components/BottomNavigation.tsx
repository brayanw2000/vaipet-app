import React from 'react';
import { Home, PawPrint, Users, Store, Settings } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { cn } from '@/lib/utils';

const BRAND = '#31D880';

const navItems = [
  { icon: PawPrint, route: '/search-walk', label: 'Passeio' },
  { icon: Users, route: '/rede-pet', label: 'Rede' },
  { icon: Home, route: '/inicio', label: 'Home' },
  { icon: Store, route: '/petshop', label: 'Shop' },
  { icon: Settings, route: '/configuracoes', label: 'Ajustes' },
];

export const BottomNavigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Always render INVERTED relative to the page so the bar pops.
  const { inverted } = useHomeTheme();
  const BG = inverted.paper; // navbar background (inverted page paper)
  const FG = inverted.ink;   // icon color on the bar

  const isActive = (route: string) =>
    route === '/inicio' ? location.pathname === '/inicio' || location.pathname === '/' : location.pathname.startsWith(route);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      <div className="max-w-md mx-auto">
        <div
          className="relative backdrop-blur-xl bg-background/80"
          style={{
            paddingTop: 8,
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
            borderTop: `0.5px solid hsl(var(--separator))`,
          }}
        >
          {/* subtle organic highlight */}
          <span
            aria-hidden
            className="absolute left-0 right-0 top-0 pointer-events-none"
            style={{
              height: 1,
              background:
                `linear-gradient(90deg, transparent 0%, ${FG}1A 50%, transparent 100%)`,
              borderRadius: '32px 32px 0 0',
            }}
          />

          <div className="relative flex items-center justify-around px-4">
            {navItems.map((item) => {
              const active = isActive(item.route);
              const IconComponent = item.icon;

              return (
                <button
                  key={item.route}
                  id={item.route === '/petshop' ? 'tour-nav-shop' : item.route === '/search-walk' ? 'tour-nav-walk' : undefined}
                  onClick={() => navigate(item.route)}
                  aria-label={item.label}
                  className="relative flex flex-col items-center justify-center transition-all duration-200 active:opacity-60"
                  style={{
                    width: 72,
                    height: 50,
                  }}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-0"
                      style={{
                        background: 'transparent',
                        borderRadius: '12px',
                      }}
                    />
                  )}
                  <div className="flex flex-col items-center gap-1">
                    <IconComponent
                      className="relative transition-all duration-300"
                      style={{
                        width: 24,
                        height: 24,
                        color: active ? BRAND : `hsl(var(--muted-foreground))`,
                      }}
                      strokeWidth={active ? 2.4 : 2}
                    />
                    <span className={cn(
                      "text-[10px] font-medium transition-colors",
                      active ? "text-primary" : "text-muted-foreground"
                    )}>
                      {item.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
