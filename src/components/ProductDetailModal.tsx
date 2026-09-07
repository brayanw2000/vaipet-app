import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { 
  Package, 
  Store, 
  ShoppingCart, 
  Star, 
  Heart,
  Share2,
  Truck,
  Shield,
  ArrowLeft,
  ArrowRight,
  MapPin,
  Clock,
  Award
} from 'lucide-react';

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  weight?: number;
  dimensions?: string;
  origin_city?: string;
  is_active: boolean;
  petshop_id: string;
  product_images: { image_url: string }[];
  inventory: { quantity: number } | null;
  profiles: { full_name: string } | null;
}

interface ProductDetailModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  isOpen,
  onClose,
}) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);

  if (!product) return null;

  const images = product.product_images?.length > 0 
    ? product.product_images.map(img => img.image_url)
    : [];
  
  const stock = product.inventory?.quantity || 0;
  const isInStock = stock > 0;

  const nextImage = () => {
    setCurrentImageIndex((prev) => 
      prev === images.length - 1 ? 0 : prev + 1
    );
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => 
      prev === 0 ? images.length - 1 : prev - 1
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden p-0">
        <div className="flex flex-col md:flex-row h-full">
          {/* Galeria de imagens */}
          <div className="flex-1 relative bg-muted/30">
            <div className="aspect-square relative overflow-hidden">
              {images.length > 0 ? (
                <>
                  <img
                    src={images[currentImageIndex]}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                  
                  {images.length > 1 && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-white/80 hover:bg-white"
                        onClick={prevImage}
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-white/80 hover:bg-white"
                        onClick={nextImage}
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                      
                      {/* Indicadores */}
                      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2">
                        {images.map((_, index) => (
                          <button
                            key={index}
                            className={`w-2 h-2 rounded-full transition-all ${
                              index === currentImageIndex 
                                ? 'bg-white' 
                                : 'bg-white/50'
                            }`}
                            onClick={() => setCurrentImageIndex(index)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Package className="h-24 w-24 text-muted-foreground/50" />
                </div>
              )}
            </div>
            
            {/* Miniaturas */}
            {images.length > 1 && (
              <div className="p-4 flex gap-2 overflow-x-auto">
                {images.map((image, index) => (
                  <button
                    key={index}
                    className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                      index === currentImageIndex 
                        ? 'border-primary' 
                        : 'border-transparent'
                    }`}
                    onClick={() => setCurrentImageIndex(index)}
                  >
                    <img
                      src={image}
                      alt={`${product.name} ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {/* Informações do produto */}
          <div className="flex-1 p-6 overflow-y-auto">
            <DialogHeader className="space-y-4">
              <div className="flex items-start justify-between">
                <DialogTitle className="text-2xl font-bold leading-tight pr-4">
                  {product.name}
                </DialogTitle>
                
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm">
                    <Heart className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Share2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              {/* Avaliações */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <div className="flex">
                    {[...Array(5)].map((_, i) => (
                      <Star 
                        key={i} 
                        className="h-4 w-4 fill-yellow-400 text-yellow-400" 
                      />
                    ))}
                  </div>
                  <span className="text-sm font-medium">4.8</span>
                  <span className="text-sm text-muted-foreground">(127 avaliações)</span>
                </div>
                
                <Badge className="bg-green-100 text-green-800">
                  <Award className="h-3 w-3 mr-1" />
                  Mais vendido
                </Badge>
              </div>
            </DialogHeader>
            
            <Separator className="my-6" />
            
            {/* Preço */}
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-3xl font-bold text-primary">
                  R$ {Number(product.price).toFixed(2)}
                </div>
                <div className="text-sm text-muted-foreground">
                  em até 12x de R$ {(Number(product.price) / 12).toFixed(2)} sem juros
                </div>
              </div>
              
              {/* Informações de entrega */}
              <Card className="border-green-200 bg-green-50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-green-700 mb-2">
                    <Truck className="h-4 w-4" />
                    <span className="font-medium">Frete grátis</span>
                  </div>
                  <div className="text-sm text-green-600">
                    Entrega em 2-3 dias úteis
                  </div>
                </CardContent>
              </Card>
              
              {/* Estoque */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Estoque:</span>
                  <Badge variant={isInStock ? "outline" : "destructive"}>
                    {isInStock ? `${stock} disponível` : 'Esgotado'}
                  </Badge>
                </div>
                
                {isInStock && stock <= 10 && (
                  <div className="text-sm text-[#31D880] font-medium">
                    ⚠️ Últimas unidades!
                  </div>
                )}
              </div>
              
              {/* Quantidade e compra */}
              {isInStock && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">Quantidade:</span>
                    <div className="flex items-center border rounded-lg">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      >
                        -
                      </Button>
                      <span className="w-12 text-center text-sm">{quantity}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => setQuantity(Math.min(stock, quantity + 1))}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <Button className="w-full h-12 text-base font-semibold">
                      <ShoppingCart className="h-5 w-5 mr-2" />
                      Comprar agora
                    </Button>
                    
                    <Button variant="outline" className="w-full h-12 text-base">
                      Adicionar ao carrinho
                    </Button>
                  </div>
                </div>
              )}
            </div>
            
            <Separator className="my-6" />
            
            {/* Informações da loja */}
            <div className="space-y-4">
              <h3 className="font-semibold">Vendido por</h3>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center">
                  <Store className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <div className="font-medium">{product.profiles?.full_name || 'Loja'}</div>
                  <div className="text-sm text-muted-foreground">
                    {product.origin_city && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {product.origin_city}
                      </div>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm">
                  Ver loja
                </Button>
              </div>
            </div>
            
            <Separator className="my-6" />
            
            {/* Descrição */}
            <div className="space-y-4">
              <h3 className="font-semibold">Descrição do produto</h3>
              <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {product.description || 'Descrição não disponível.'}
              </div>
            </div>
            
            {/* Especificações */}
            {(product.weight || product.dimensions || product.category) && (
              <>
                <Separator className="my-6" />
                <div className="space-y-4">
                  <h3 className="font-semibold">Especificações</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {product.category && (
                      <div>
                        <span className="text-muted-foreground">Categoria:</span>
                        <div className="font-medium">{product.category}</div>
                      </div>
                    )}
                    {product.weight && (
                      <div>
                        <span className="text-muted-foreground">Peso:</span>
                        <div className="font-medium">{product.weight}kg</div>
                      </div>
                    )}
                    {product.dimensions && (
                      <div>
                        <span className="text-muted-foreground">Dimensões:</span>
                        <div className="font-medium">{product.dimensions}</div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
            
            {/* Garantias */}
            <Separator className="my-6" />
            <div className="space-y-4">
              <h3 className="font-semibold">Garantias</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <Shield className="h-4 w-4 text-green-600" />
                  <span>Compra protegida</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span>7 dias para devolução</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Award className="h-4 w-4 text-[#31D880]" />
                  <span>Garantia do fabricante</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};