import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { PetshopBottomNavigation } from '@/components/petshop/PetshopBottomNavigation';
import { PetshopHeader } from '@/components/petshop/PetshopHeader';
import { Button } from '@/components/ui/button';
import { 
  User, 
  Bell, 
  Shield, 
  HelpCircle, 
  Store,
  CreditCard,
  Truck,
  BarChart3,
  LogOut,
  ChevronRight 
} from 'lucide-react';

const PetshopSettings = () => {
  const { signOut, user, loading, profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && (!user || profile?.role !== 'petshop')) {
      navigate('/auth');
    }
  }, [user, loading, profile, navigate]);

  const handleLogout = async () => {
    await signOut();
    navigate('/auth');
  };

  const settingsOptions = [
    {
      icon: Store,
      title: 'Informações da Loja',
      description: 'Nome, endereço, contato e horários',
      onClick: () => {
        // TODO: Implementar página de informações da loja
        console.log('Navegar para informações da loja');
      }
    },
    {
      icon: User,
      title: 'Perfil do Proprietário',
      description: 'Dados pessoais e documentos',
      onClick: () => {
        // TODO: Implementar página de perfil do proprietário
        console.log('Navegar para perfil do proprietário');
      }
    },
    {
      icon: CreditCard,
      title: 'Forma de Pagamento',
      description: 'Contas bancárias e métodos de recebimento',
      onClick: () => {
        // TODO: Implementar página de formas de pagamento
        console.log('Navegar para formas de pagamento');
      }
    },
    {
      icon: Truck,
      title: 'Entrega e Frete',
      description: 'Configurar opções de entrega',
      onClick: () => {
        // TODO: Implementar página de configurações de entrega
        console.log('Navegar para configurações de entrega');
      }
    },
    {
      icon: BarChart3,
      title: 'Relatórios',
      description: 'Configurar relatórios personalizados',
      onClick: () => {
        // TODO: Implementar página de configurações de relatórios
        console.log('Navegar para configurações de relatórios');
      }
    },
    {
      icon: Bell,
      title: 'Notificações',
      description: 'Gerenciar alertas e notificações',
      onClick: () => {
        // TODO: Implementar página de configurações de notificações
        console.log('Navegar para configurações de notificações');
      }
    },
    {
      icon: Shield,
      title: 'Privacidade e Segurança',
      description: 'Senhas, autenticação e privacidade',
      onClick: () => {
        // TODO: Implementar página de privacidade e segurança
        console.log('Navegar para privacidade e segurança');
      }
    },
    {
      icon: HelpCircle,
      title: 'Ajuda e Suporte',
      description: 'Central de ajuda e contato',
      onClick: () => {
        // TODO: Implementar página de ajuda e suporte
        console.log('Navegar para ajuda e suporte');
      }
    }
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user || profile?.role !== 'petshop') {
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-md mx-auto relative">
      <div className="flex-1 pb-24">
        <PetshopHeader />
        
        <div className="px-6 py-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Configurações</h1>
            <p className="text-muted-foreground">Gerencie as configurações da sua loja</p>
          </div>

          {/* Store Info Card */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-6">
            <div className="flex items-center space-x-3">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Store className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">{profile?.full_name || 'Minha Loja'}</h3>
                <p className="text-sm text-muted-foreground">{profile?.email}</p>
              </div>
            </div>
          </div>

          {/* Settings Options */}
          <div className="space-y-2">
            {settingsOptions.map((option, index) => {
              const Icon = option.icon;
              return (
                <Button
                  key={index}
                  variant="ghost"
                  onClick={option.onClick}
                  className="w-full justify-start h-auto p-4 hover:bg-muted/50"
                >
                  <div className="flex items-center w-full">
                    <div className="flex items-center space-x-3 flex-1">
                      <div className="bg-muted p-2 rounded-lg">
                        <Icon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-foreground">{option.title}</p>
                        <p className="text-sm text-muted-foreground">{option.description}</p>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </Button>
              );
            })}
          </div>

          {/* Logout Button */}
          <div className="pt-6 border-t border-border">
            <Button
              variant="ghost"
              onClick={handleLogout}
              className="w-full justify-start h-auto p-4 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <div className="flex items-center space-x-3">
                <div className="bg-destructive/10 p-2 rounded-lg">
                  <LogOut className="h-5 w-5 text-destructive" />
                </div>
                <div className="text-left">
                  <p className="font-medium">Sair da Conta</p>
                  <p className="text-sm text-muted-foreground">Desconectar da sua conta</p>
                </div>
              </div>
            </Button>
          </div>
        </div>
      </div>
      
      <PetshopBottomNavigation />
    </div>
  );
};

export default PetshopSettings;