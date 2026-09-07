import React, { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { PetshopBottomNavigation } from '@/components/petshop/PetshopBottomNavigation';
import { PetshopHeader } from '@/components/petshop/PetshopHeader';
import { ProductCard } from '@/components/petshop/ProductCard';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Package } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  is_active: boolean;
  product_images: { image_url: string }[] | null;
  inventory: { quantity: number } | null;
}

const PetshopProducts = () => {
  const { user, loading, profile } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  useEffect(() => {
    if (!loading && (!user || profile?.role !== 'petshop')) {
      navigate('/auth');
    }
  }, [user, loading, profile, navigate]);

  useEffect(() => {
    if (user && profile?.role === 'petshop') {
      fetchProducts();
    }
  }, [user, profile]);

  const fetchProducts = async () => {
    try {
      setLoadingProducts(true);
      console.log('Fetching products for user:', user?.id);
      
      // First get products
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('*')
        .eq('petshop_id', user?.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      console.log('Products data:', productsData);
      console.log('Products error:', productsError);

      if (productsError) throw productsError;

      if (!productsData || productsData.length === 0) {
        setProducts([]);
        return;
      }

      // Get product IDs for images and inventory
      const productIds = productsData.map(p => p.id);

      // Get product images
      const { data: imagesData } = await supabase
        .from('product_images')
        .select('product_id, image_url')
        .in('product_id', productIds);

      // Get inventory
      const { data: inventoryData } = await supabase
        .from('inventory')
        .select('product_id, quantity')
        .in('product_id', productIds);

      // Combine data
      const productsWithDetails = productsData.map(product => ({
        ...product,
        product_images: imagesData?.filter(img => img.product_id === product.id).map(img => ({ image_url: img.image_url })) || [],
        inventory: inventoryData?.find(inv => inv.product_id === product.id) || null
      }));

      setProducts(productsWithDetails as Product[]);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoadingProducts(false);
    }
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
        
        <div className="px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Produtos</h1>
              <p className="text-muted-foreground">Gerencie seus produtos</p>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={fetchProducts}
                disabled={loadingProducts}
              >
                Atualizar
              </Button>
              <Button onClick={() => navigate('/petshop-add-product')} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Adicionar
              </Button>
            </div>
          </div>

          {loadingProducts ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Carregando produtos...</p>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center mb-4">
                <Package className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Nenhum produto cadastrado</h3>
              <p className="text-muted-foreground mb-4">Comece adicionando seu primeiro produto</p>
              <Button onClick={() => navigate('/petshop-add-product')}>
                <Plus className="h-4 w-4 mr-2" />
                Adicionar Produto
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onEdit={() => navigate(`/petshop-edit-product/${product.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      
      <PetshopBottomNavigation />
    </div>
  );
};

export default PetshopProducts;