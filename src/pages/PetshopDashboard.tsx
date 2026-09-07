import { useEffect, useState } from 'react';
import { SplashScreen } from '@/components/SplashScreen';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { PetshopBottomNavigation } from '@/components/petshop/PetshopBottomNavigation';
import { PetshopHeader } from '@/components/petshop/PetshopHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Package, ShoppingCart, TrendingUp, AlertTriangle } from 'lucide-react';

const PetshopDashboard = () => {
  const { user, loading, profile } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalOrders: 0,
    lowStockProducts: 0,
    monthlyRevenue: 0
  });

  useEffect(() => {
    if (!loading && (!user || profile?.role !== 'petshop')) {
      navigate('/auth');
    }
  }, [user, loading, profile, navigate]);

  useEffect(() => {
    if (user && profile?.role === 'petshop') {
      fetchStats();
    }
  }, [user, profile]);

  const fetchStats = async () => {
    try {
      const { count: productsCount } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('petshop_id', user?.id)
        .eq('is_active', true);

      const { count: lowStockCount } = await supabase
        .from('inventory')
        .select('*, products!inner(*)', { count: 'exact', head: true })
        .lte('quantity', 5)
        .eq('products.petshop_id', user?.id);

      setStats({
        totalProducts: productsCount || 0,
        totalOrders: 0,
        lowStockProducts: lowStockCount || 0,
        monthlyRevenue: 0
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  if (loading) {
    return <SplashScreen />;
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
            <h1 className="text-2xl font-bold text-foreground mb-2">Dashboard</h1>
            <p className="text-muted-foreground">Bem-vindo ao seu painel de controle</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Produtos</CardTitle>
                <Package className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalProducts}</div>
                <p className="text-xs text-muted-foreground">Total de produtos ativos</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pedidos</CardTitle>
                <ShoppingCart className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalOrders}</div>
                <p className="text-xs text-muted-foreground">Total de pedidos</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Estoque Baixo</CardTitle>
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-destructive">{stats.lowStockProducts}</div>
                <p className="text-xs text-muted-foreground">Produtos com estoque baixo</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Receita Mensal</CardTitle>
                <TrendingUp className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">R$ {stats.monthlyRevenue.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">Este mês</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      
      <PetshopBottomNavigation />
    </div>
  );
};

export default PetshopDashboard;
