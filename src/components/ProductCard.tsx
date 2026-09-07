import React from 'react';
import { Package, Star, ArrowUpRight } from 'lucide-react';
import { useHomeTheme } from '@/hooks/useHomeTheme';

const BRAND = '#31D880';

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  is_active: boolean;
  petshop_id: string;
  product_images: { image_url: string }[];
  inventory: { quantity: number } | null;
  profiles: { full_name: string } | null;
}

interface ProductCardProps {
  product: Product;
  onClick: () => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onClick }) => {
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;

  const mainImage = product.product_images?.[0]?.image_url;
  const stock = product.inventory?.quantity ?? null;
  const isInStock = stock === null || stock > 0;
  const lowStock = isInStock && stock !== null && stock <= 5;

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex gap-3.5 p-3 active:scale-[0.99] transition-transform"
      style={{
        background: PAPER,
        border: `1px solid ${INK}1A`,
        borderRadius: 22,
        fontFamily: 'DM Sans, sans-serif',
        color: INK,
      }}
    >
      {/* Image */}
      <div
        className="relative flex-shrink-0 overflow-hidden flex items-center justify-center"
        style={{
          width: 88,
          height: 88,
          borderRadius: 18,
          background: `${INK}0A`,
        }}
      >
        {mainImage ? (
          <img
            src={mainImage}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <Package className="w-8 h-8" style={{ color: INK, opacity: 0.3 }} />
        )}
        {!isInStock && (
          <div
            className="absolute inset-0 flex items-center justify-center text-[9px] font-bold uppercase tracking-[0.22em]"
            style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}
          >
            Esgotado
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        <div>
          {product.category && (
            <span
              className="text-[9px] font-bold uppercase tracking-[0.22em]"
              style={{ opacity: 0.5 }}
            >
              {product.category}
            </span>
          )}
          <h3
            className="font-bold leading-tight mt-0.5 line-clamp-2"
            style={{
              fontFamily: 'Space Grotesk, sans-serif',
              fontSize: 15,
              letterSpacing: '-0.01em',
            }}
          >
            {product.name}
          </h3>
          <div
            className="mt-1 inline-flex items-center gap-1 text-[10px]"
            style={{ opacity: 0.6 }}
          >
            <Star className="w-3 h-3 fill-current" style={{ color: BRAND }} />
            <span>4.8 · {product.profiles?.full_name || 'Loja'}</span>
          </div>
        </div>

        <div className="flex items-end justify-between mt-1.5">
          <div>
            <span
              className="block leading-none"
              style={{
                fontFamily: 'Space Grotesk, sans-serif',
                fontWeight: 700,
                fontSize: 18,
                letterSpacing: '-0.02em',
              }}
            >
              R$ {Number(product.price).toFixed(2)}
            </span>
            {lowStock && (
              <span
                className="text-[9px] font-bold uppercase tracking-[0.18em] mt-0.5 inline-block"
                style={{ color: BRAND }}
              >
                Últimas · {stock}
              </span>
            )}
          </div>
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: BRAND, color: '#0B1410' }}
          >
            <ArrowUpRight className="w-4 h-4" strokeWidth={2.6} />
          </div>
        </div>
      </div>
    </button>
  );
};