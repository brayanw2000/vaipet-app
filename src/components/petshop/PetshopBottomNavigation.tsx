import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Store, Package, BarChart3, Boxes, Settings } from 'lucide-react';

export const PetshopBottomNavigation = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { icon: Store, label: 'Dashboard', path: '/petshop-dashboard' },
    { icon: Package, label: 'Produtos', path: '/petshop-products' },
    { icon: BarChart3, label: 'Vendas', path: '/petshop-sales' },
    { icon: Boxes, label: 'Estoque', path: '/petshop-stock' },
    { icon: Settings, label: 'Config', path: '/petshop-settings' },
  ];

  return (
    <div className="fixed bottom-0 left-1/2 transform -translate-x-1/2 w-full max-w-md bg-card border-t border-border">
      <div className="flex items-center justify-around py-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center py-2 px-3 rounded-lg transition-colors ${
                isActive
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon size={20} />
              <span className="text-xs mt-1 font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};