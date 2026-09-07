import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { PetshopBottomNavigation } from '@/components/petshop/PetshopBottomNavigation';
import { PetshopHeader } from '@/components/petshop/PetshopHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Calendar, DollarSign, Package } from 'lucide-react';

const PetshopSales = () => {
  const { user, loading, profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && (!user || profile?.role !== 'petshop')) {
      navigate('/auth');
    }
  }, [user, loading, profile, navigate]);

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
            <h1 className="text-2xl font-bold text-foreground mb-2">Vendas</h1>
            <p className="text-muted-foreground">Relatório de vendas e pedidos</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Vendas</CardTitle>
                <TrendingUp className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">0</div>
                <p className="text-xs text-muted-foreground">Pedidos totais</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Receita Mensal</CardTitle>
                <DollarSign className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">R$ 0,00</div>
                <p className="text-xs text-muted-foreground">Este mês</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pendentes</CardTitle>
                <Calendar className="h-4 w-4 text-yellow-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">0</div>
                <p className="text-xs text-muted-foreground">Aguardando</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Concluídos</CardTitle>
                <Package className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">0</div>
                <p className="text-xs text-muted-foreground">Finalizados</p>
              </CardContent>
            </Card>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">Pedidos Recentes</h2>
            <div className="text-center py-8">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Nenhum pedido encontrado</p>
              <p className="text-sm text-muted-foreground mt-1">Os pedidos aparecerão aqui quando forem criados</p>
            </div>
          </div>
        </div>
      </div>
      
      <PetshopBottomNavigation />
    </div>
  );
};

export default PetshopSales;
