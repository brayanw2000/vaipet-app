import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { PetshopBottomNavigation } from '@/components/petshop/PetshopBottomNavigation';
import { PetshopHeader } from '@/components/petshop/PetshopHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Package, AlertTriangle, Plus, Minus, Search } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface InventoryItem {
  id: string;
  product_id: string;
  quantity: number;
  products: {
    id: string;
    name: string;
    category: string;
    price: number;
  };
}

const PetshopStock = () => {
  const { user, loading, profile } = useAuth();
  const navigate = useNavigate();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!loading && (!user || profile?.role !== 'petshop')) {
      navigate('/auth');
    }
  }, [user, loading, profile, navigate]);

  useEffect(() => {
    if (user && profile?.role === 'petshop') {
      fetchInventory();
    }
  }, [user, profile]);

  const fetchInventory = async () => {
    try {
      const { data: inventoryData, error } = await supabase
        .from('inventory')
        .select('*')
        .order('quantity', { ascending: true });

      if (error) throw error;

      const productIds = inventoryData?.map(item => item.product_id) || [];
      const { data: productsData } = await supabase
        .from('products')
        .select('id, name, category, price')
        .eq('petshop_id', user?.id)
        .in('id', productIds);

      const inventoryWithProducts = inventoryData?.filter(item => {
        return productsData?.find(p => p.id === item.product_id);
      }).map(item => ({
        ...item,
        products: productsData?.find(p => p.id === item.product_id) || { id: '', name: '', category: '', price: 0 }
      })) || [];

      setInventory(inventoryWithProducts as InventoryItem[]);
    } catch (error) {
      console.error('Error fetching inventory:', error);
      toast({ title: "Erro", description: "Não foi possível carregar o estoque", variant: "destructive" });
    } finally {
      setLoadingInventory(false);
    }
  };

  const updateQuantity = async (inventoryId: string, newQuantity: number) => {
    if (newQuantity < 0) return;
    setUpdatingItems(prev => new Set(prev.add(inventoryId)));
    try {
      const { error } = await supabase.from('inventory').update({ quantity: newQuantity }).eq('id', inventoryId);
      if (error) throw error;
      setInventory(prev => prev.map(item => item.id === inventoryId ? { ...item, quantity: newQuantity } : item));
      toast({ title: "Sucesso", description: "Quantidade atualizada com sucesso" });
    } catch (error) {
      console.error('Error updating quantity:', error);
      toast({ title: "Erro", description: "Não foi possível atualizar a quantidade", variant: "destructive" });
    } finally {
      setUpdatingItems(prev => { const newSet = new Set(prev); newSet.delete(inventoryId); return newSet; });
    }
  };

  const getStockStatus = (quantity: number) => {
    if (quantity === 0) return { label: 'Sem Estoque', color: 'bg-red-100 text-red-800' };
    if (quantity <= 5) return { label: 'Estoque Baixo', color: 'bg-yellow-100 text-yellow-800' };
    return { label: 'Em Estoque', color: 'bg-green-100 text-green-800' };
  };

  const filteredInventory = inventory.filter(item =>
    item.products.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.products.category?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stockStats = {
    totalProducts: inventory.length,
    lowStock: inventory.filter(item => item.quantity <= 5).length,
    outOfStock: inventory.filter(item => item.quantity === 0).length,
    inStock: inventory.filter(item => item.quantity > 5).length
  };

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
            <h1 className="text-2xl font-bold text-foreground mb-2">Estoque</h1>
            <p className="text-muted-foreground">Gerenciamento de estoque</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Produtos</CardTitle>
                <Package className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stockStats.totalProducts}</div>
                <p className="text-xs text-muted-foreground">Produtos cadastrados</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Em Estoque</CardTitle>
                <Package className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{stockStats.inStock}</div>
                <p className="text-xs text-muted-foreground">Produtos disponíveis</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Estoque Baixo</CardTitle>
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">{stockStats.lowStock}</div>
                <p className="text-xs text-muted-foreground">Necessitam reposição</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Sem Estoque</CardTitle>
                <AlertTriangle className="h-4 w-4 text-red-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{stockStats.outOfStock}</div>
                <p className="text-xs text-muted-foreground">Produtos esgotados</p>
              </CardContent>
            </Card>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input placeholder="Buscar produtos..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">Produtos em Estoque</h2>
            {loadingInventory ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">Carregando estoque...</p>
              </div>
            ) : filteredInventory.length === 0 ? (
              <div className="text-center py-8">
                <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">{searchTerm ? 'Nenhum produto encontrado' : 'Nenhum produto no estoque'}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredInventory.map((item) => {
                  const status = getStockStatus(item.quantity);
                  const isUpdating = updatingItems.has(item.id);
                  return (
                    <Card key={item.id}>
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1">
                            <h3 className="font-medium text-foreground">{item.products.name}</h3>
                            <p className="text-sm text-muted-foreground">{item.products.category}</p>
                            <p className="text-sm text-primary font-medium">R$ {Number(item.products.price).toFixed(2)}</p>
                          </div>
                          <Badge className={status.color}>{status.label}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <Button variant="outline" size="sm" onClick={() => updateQuantity(item.id, item.quantity - 1)} disabled={item.quantity <= 0 || isUpdating}>
                              <Minus className="h-4 w-4" />
                            </Button>
                            <div className="text-center min-w-[60px]">
                              <p className="text-lg font-bold">{item.quantity}</p>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => updateQuantity(item.id, item.quantity + 1)} disabled={isUpdating}>
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                          {isUpdating && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      
      <PetshopBottomNavigation />
    </div>
  );
};

export default PetshopStock;
