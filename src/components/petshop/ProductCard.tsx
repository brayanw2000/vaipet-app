import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit, Eye, Package } from 'lucide-react';

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

interface ProductCardProps {
  product: Product;
  onEdit: () => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onEdit }) => {
  const mainImage = product.product_images?.[0]?.image_url;
  const stock = product.inventory?.quantity || 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex gap-3">
          <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
            {mainImage ? (
              <img 
                src={mainImage} 
                alt={product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <Package className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-semibold text-foreground truncate">{product.name}</h3>
              <div className="flex gap-1 ml-2">
                <Button size="sm" variant="ghost" onClick={onEdit}>
                  <Edit className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
              {product.description}
            </p>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-primary">R$ {product.price.toFixed(2)}</span>
                <Badge variant={product.is_active ? "default" : "secondary"}>
                  {product.is_active ? 'Ativo' : 'Inativo'}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <Badge variant={stock <= 5 ? "destructive" : "outline"}>
                  Estoque: {stock}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};