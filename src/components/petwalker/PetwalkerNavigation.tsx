import { LayoutDashboard, History, Wallet, User } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

const items = [
  { icon: LayoutDashboard, route: '/petwalker', label: 'Dashboard' },
  { icon: History, route: '/petwalker/historico', label: 'Histórico' },
  { icon: Wallet, route: '/petwalker/ganhos', label: 'Ganhos' },
  { icon: User, route: '/petwalker/perfil', label: 'Perfil' },
];

export const PetwalkerNavigation = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isActive = (route: string) =>
    route === '/petwalker' ? pathname === '/petwalker' : pathname.startsWith(route);

  return (
    <nav
      aria-label="Navegação do PetWalker"
      className="fixed bottom-0 left-0 right-0 z-[60] border-t border-border bg-background/95 backdrop-blur"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
    >
      <div className="max-w-md mx-auto flex items-center justify-around pt-2">
        {items.map(({ icon: Icon, route, label }) => {
          const active = isActive(route);
          return (
            <button
              key={route}
              onClick={() => navigate(route)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition-colors active:scale-95 ${
                active ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={active ? 2.4 : 1.8} />
              <span className="text-[11px] font-semibold">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};