import React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { ProductForm } from '@/components/petshop/ProductForm';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PetshopAddProduct = () => {
  const { user, loading, profile } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
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
            <h1 className="text-xl font-bold text-foreground">Adicionar Produto</h1>
            <p className="text-sm text-muted-foreground">Cadastre um novo produto</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        <ProductForm onSuccess={() => navigate('/petshop-products')} />
      </div>
    </div>
  );
};

export default PetshopAddProduct;