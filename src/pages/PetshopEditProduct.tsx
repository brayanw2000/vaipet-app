import React, { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useParams } from 'react-router-dom';
import { ProductForm } from '@/components/petshop/ProductForm';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  weight: number;
  dimensions: string;
  origin_city: string;
  is_active: boolean;
  product_images: { image_url: string }[];
  inventory: { quantity: number } | null;
}

const PetshopEditProduct = () => {
  const { user, loading, profile } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(true);

  React.useEffect(() => {
    if (!loading && (!user || profile?.role !== 'petshop')) {
      navigate('/auth');
    }
  }, [user, loading, profile, navigate]);

  useEffect(() => {
    if (id && user && profile?.role === 'petshop') {
      fetchProduct();
    }
  }, [id, user, profile]);

  const fetchProduct = async () => {
    try {
      setLoadingProduct(true);
      
      // Get product data
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .eq('petshop_id', user?.id)
        .single();

      if (productError) throw productError;

      // Get product images
      const { data: imagesData } = await supabase
        .from('product_images')
        .select('image_url')
        .eq('product_id', id)
        .order('display_order');

      // Get inventory
      const { data: inventoryData } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('product_id', id)
        .single();

      const productWithDetails = {
        ...productData,
        product_images: imagesData || [],
        inventory: inventoryData
      };

      setProduct(productWithDetails as Product);
    } catch (error) {
      console.error('Error fetching product:', error);
      navigate('/petshop-products');
    } finally {
      setLoadingProduct(false);
    }
  };

  if (loading || loadingProduct) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user || profile?.role !== 'petshop' || !product) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto">
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/petshop-products')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">Editar Produto</h1>
            <p className="text-sm text-muted-foreground">Atualize as informações do produto</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        <ProductForm 
          initialData={{
            id: product.id,
            name: product.name,
            description: product.description,
            price: product.price,
            category: product.category,
            weight: product.weight,
            dimensions: product.dimensions,
            origin_city: product.origin_city,
            is_active: product.is_active,
            stock_quantity: product.inventory?.quantity || 0
          }}
          onSuccess={() => navigate('/petshop-products')} 
        />
      </div>
    </div>
  );
};

export default PetshopEditProduct;