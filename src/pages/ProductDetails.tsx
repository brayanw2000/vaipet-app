import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useHomeTheme } from '@/hooks/useHomeTheme';
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
  MapPin,
  Clock,
  Award,
  Minus,
  Plus,
} from 'lucide-react';

const BRAND = '#31D880';

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

const ProductDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (id) {
      fetchProduct();
    }
  }, [id]);

  const fetchProduct = async () => {
    try {
      setLoading(true);
      
      // Buscar produto
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (productError || !productData) {
        console.error('Product not found:', productError);
        return;
      }

      // Buscar perfil do petshop usando RPC seguro
      const { data: profilesData } = await supabase
        .rpc('get_public_profiles', { user_ids: [productData.petshop_id] });
      
      const profileData = profilesData && profilesData.length > 0 ? profilesData[0] : null;

      // Buscar imagens
      const { data: imagesData } = await supabase
        .from('product_images')
        .select('image_url')
        .eq('product_id', id)
        .order('display_order');

      // Buscar estoque
      const { data: inventoryData } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('product_id', id)
        .single();

      const productWithDetails: Product = {
        ...productData,
        product_images: imagesData || [],
        inventory: inventoryData ? { quantity: inventoryData.quantity } : null,
        profiles: profileData || null
      };

      setProduct(productWithDetails);
    } catch (error) {
      console.error('Error fetching product:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center max-w-md mx-auto">
        <div
          className="animate-spin rounded-full h-8 w-8"
          style={{ borderBottom: `2px solid ${BRAND}` }}
        />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center max-w-md mx-auto p-6 text-center">
        <Package className="w-12 h-12 mb-3 opacity-40" />
        <h2 className="font-bold mb-3" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Produto não encontrado
        </h2>
        <button
          onClick={() => navigate('/petshop')}
          className="px-5 py-3 rounded-full font-bold text-[13px]"
          style={{ background: BRAND, color: '#0B1410' }}
        >
          Voltar à loja
        </button>
      </div>
    );
  }

  const images = product.product_images?.length > 0 
    ? product.product_images.map(img => img.image_url)
    : [];
  
  const stock = product.inventory?.quantity ?? null;
  const isInStock = stock === null || stock > 0;

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

  return <ProductDetailsView
    product={product}
    images={images}
    currentImageIndex={currentImageIndex}
    setCurrentImageIndex={setCurrentImageIndex}
    quantity={quantity}
    setQuantity={setQuantity}
    stock={stock}
    isInStock={isInStock}
    navigate={navigate}
  />;
};

const ProductDetailsView: React.FC<any> = ({
  product,
  images,
  currentImageIndex,
  setCurrentImageIndex,
  quantity,
  setQuantity,
  stock,
  isInStock,
  navigate,
}) => {
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;

  return (
    <div
      className="min-h-screen flex flex-col max-w-md mx-auto relative"
      style={{ background: PAPER, color: INK, fontFamily: 'DM Sans, sans-serif' }}
    >
      <div className="flex-1 pb-32">
        {/* Top bar */}
        <div className="px-5 pt-6 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            aria-label="Voltar"
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90"
            style={{ border: `1px solid ${INK}26`, color: INK }}
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2.2} />
          </button>
          <div className="flex gap-2">
            <button
              aria-label="Favoritar"
              className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90"
              style={{ border: `1px solid ${INK}26`, color: INK }}
            >
              <Heart className="w-4 h-4" strokeWidth={2} />
            </button>
            <button
              aria-label="Compartilhar"
              className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90"
              style={{ border: `1px solid ${INK}26`, color: INK }}
            >
              <Share2 className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Gallery */}
        <div
          className="relative mx-5 mt-5 overflow-hidden"
          style={{
            background: `${INK}0A`,
            borderRadius: 28,
            aspectRatio: '1/1',
          }}
        >
          {images.length > 0 ? (
            <img
              src={images[currentImageIndex]}
              alt={product.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package className="w-20 h-20" style={{ color: INK, opacity: 0.25 }} />
            </div>
          )}
          {images.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
              {images.map((_: any, i: number) => (
                <button
                  key={i}
                  onClick={() => setCurrentImageIndex(i)}
                  className="rounded-full transition-all"
                  style={{
                    width: i === currentImageIndex ? 18 : 6,
                    height: 6,
                    background:
                      i === currentImageIndex ? '#fff' : 'rgba(255,255,255,0.55)',
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="px-5 mt-6 space-y-5">
          {/* Headline */}
          <div>
            {product.category && (
              <span
                className="text-[10px] font-bold uppercase tracking-[0.28em]"
                style={{ opacity: 0.55 }}
              >
                {product.category}
              </span>
            )}
            <h1
              className="font-bold mt-1.5 leading-[1.05]"
              style={{
                fontFamily: 'Space Grotesk, sans-serif',
                fontSize: 26,
                letterSpacing: '-0.02em',
              }}
            >
              {product.name}
            </h1>
            <div
              className="mt-2 inline-flex items-center gap-1 text-[11px]"
              style={{ opacity: 0.7 }}
            >
              <Star className="w-3.5 h-3.5 fill-current" style={{ color: BRAND }} />
              <span className="font-semibold">4.8</span>
              <span style={{ opacity: 0.7 }}>· 127 avaliações</span>
            </div>
          </div>

          {/* Price */}
          <div
            className="p-4 flex items-end justify-between"
            style={{
              background: PAPER,
              border: `1px solid ${INK}1A`,
              borderRadius: 22,
            }}
          >
            <div>
              <span
                className="text-[9px] font-bold uppercase tracking-[0.28em]"
                style={{ opacity: 0.55 }}
              >
                Preço
              </span>
              <p
                className="leading-none mt-1.5"
                style={{
                  fontFamily: 'Space Grotesk, sans-serif',
                  fontWeight: 700,
                  fontSize: 28,
                  letterSpacing: '-0.02em',
                }}
              >
                R$ {Number(product.price).toFixed(2)}
              </p>
              <p className="text-[10px] mt-1.5" style={{ opacity: 0.6 }}>
                12x R$ {(Number(product.price) / 12).toFixed(2)} sem juros
              </p>
            </div>
            <span
              className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.18em]"
              style={
                isInStock
                  ? { background: `${BRAND}26`, color: '#0B7A45' }
                  : { background: '#FBE3E3', color: '#B23A3A' }
              }
            >
              {isInStock
                ? stock === null
                  ? 'Em estoque'
                  : `${stock} disp.`
                : 'Esgotado'}
            </span>
          </div>

          {/* Delivery + protection inline */}
          <div className="grid grid-cols-2 gap-2.5">
            <InfoChip
              icon={<Truck className="w-4 h-4" />}
              title="Frete grátis"
              sub="2-3 dias úteis"
              PAPER={PAPER}
              INK={INK}
            />
            <InfoChip
              icon={<Shield className="w-4 h-4" />}
              title="Compra"
              sub="protegida"
              PAPER={PAPER}
              INK={INK}
            />
          </div>

          {/* Description */}
          <Section title="Descrição" INK={INK}>
            <p
              className="text-[13px] leading-relaxed whitespace-pre-wrap"
              style={{ opacity: 0.78 }}
            >
              {product.description || 'Sem descrição.'}
            </p>
          </Section>

          {/* Specs */}
          {(product.weight || product.dimensions || product.category) && (
            <Section title="Especificações" INK={INK}>
              <div className="text-[13px] divide-y" style={{ borderColor: `${INK}14` }}>
                {product.category && (
                  <SpecRow label="Categoria" value={product.category} INK={INK} />
                )}
                {product.weight && (
                  <SpecRow label="Peso" value={`${product.weight} kg`} INK={INK} />
                )}
                {product.dimensions && (
                  <SpecRow label="Dimensões" value={product.dimensions} INK={INK} />
                )}
              </div>
            </Section>
          )}

          {/* Seller */}
          <Section title="Vendido por" INK={INK}>
            <div
              className="flex items-center gap-3 p-3"
              style={{
                background: PAPER,
                border: `1px solid ${INK}1A`,
                borderRadius: 18,
              }}
            >
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center"
                style={{ background: BRAND, color: '#0B1410' }}
              >
                <Store className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="font-bold text-[14px] truncate"
                  style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                >
                  {product.profiles?.full_name || 'Loja'}
                </p>
                {product.origin_city && (
                  <p
                    className="text-[11px] inline-flex items-center gap-1"
                    style={{ opacity: 0.6 }}
                  >
                    <MapPin className="w-3 h-3" />
                    {product.origin_city}
                  </p>
                )}
              </div>
              <button
                className="px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.22em]"
                style={{ border: `1px solid ${INK}26`, color: INK }}
              >
                Ver loja
              </button>
            </div>
          </Section>

          {/* Trust */}
          <Section title="Garantias" INK={INK}>
            <div className="space-y-2 text-[13px]">
              <Trust icon={<Shield className="w-4 h-4" />} text="Compra protegida" />
              <Trust icon={<Clock className="w-4 h-4" />} text="7 dias para devolução" />
              <Trust icon={<Award className="w-4 h-4" />} text="Garantia do fabricante" />
            </div>
          </Section>
        </div>
      </div>

      {/* Sticky CTA */}
      {isInStock && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 pb-safe pointer-events-none"
        >
          <div className="max-w-md mx-auto px-4 pb-4 pointer-events-auto">
            <div
              className="flex items-center gap-2 p-2"
              style={{
                background: '#0B1410',
                borderRadius: 28,
                boxShadow: '0 18px 40px -16px rgba(11,20,16,0.45)',
              }}
            >
              <div
                className="flex items-center"
                style={{
                  background: 'rgba(247,245,239,0.08)',
                  borderRadius: 22,
                  height: 52,
                }}
              >
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-full flex items-center justify-center"
                  style={{ color: '#F7F5EF' }}
                  aria-label="Diminuir"
                >
                  <Minus className="w-4 h-4" strokeWidth={2.4} />
                </button>
                <span
                  className="w-7 text-center text-[14px] font-bold"
                  style={{ color: '#F7F5EF', fontFamily: 'Space Grotesk, sans-serif' }}
                >
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity(Math.min(stock || 999, quantity + 1))}
                  className="w-10 h-full flex items-center justify-center"
                  style={{ color: '#F7F5EF' }}
                  aria-label="Aumentar"
                >
                  <Plus className="w-4 h-4" strokeWidth={2.4} />
                </button>
              </div>
              <button
                className="flex-1 h-[52px] flex items-center justify-center gap-2 font-bold"
                style={{
                  background: BRAND,
                  color: '#0B1410',
                  borderRadius: 22,
                  fontFamily: 'Space Grotesk, sans-serif',
                  letterSpacing: '-0.01em',
                  fontSize: 15,
                }}
              >
                <ShoppingCart className="w-4 h-4" strokeWidth={2.6} />
                Comprar agora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Section: React.FC<{ title: string; INK: string; children: React.ReactNode }> = ({
  title,
  INK,
  children,
}) => (
  <div>
    <h3
      className="text-[10px] font-bold uppercase tracking-[0.28em] mb-2"
      style={{ color: INK, opacity: 0.55 }}
    >
      {title}
    </h3>
    {children}
  </div>
);

const SpecRow: React.FC<{ label: string; value: string; INK: string }> = ({
  label,
  value,
  INK,
}) => (
  <div className="flex justify-between py-2">
    <span style={{ opacity: 0.6 }}>{label}</span>
    <span className="font-semibold">{value}</span>
  </div>
);

const InfoChip: React.FC<{
  icon: React.ReactNode;
  title: string;
  sub: string;
  PAPER: string;
  INK: string;
}> = ({ icon, title, sub, PAPER, INK }) => (
  <div
    className="flex items-center gap-2.5 p-3"
    style={{
      background: PAPER,
      border: `1px solid ${INK}1A`,
      borderRadius: 18,
    }}
  >
    <div
      className="w-8 h-8 rounded-xl flex items-center justify-center"
      style={{ background: `${BRAND}26`, color: '#0B7A45' }}
    >
      {icon}
    </div>
    <div>
      <p
        className="font-bold leading-none text-[12px]"
        style={{ fontFamily: 'Space Grotesk, sans-serif' }}
      >
        {title}
      </p>
      <p className="text-[10px] mt-0.5" style={{ opacity: 0.6 }}>
        {sub}
      </p>
    </div>
  </div>
);

const Trust: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="flex items-center gap-2.5">
    <span style={{ color: BRAND }}>{icon}</span>
    <span>{text}</span>
  </div>
);

export default ProductDetails;