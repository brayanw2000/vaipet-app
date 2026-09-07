import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomNavigation } from '@/components/BottomNavigation';
import { ProductCard } from '@/components/ProductCard';
import { supabase } from '@/integrations/supabase/client';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Search,
  Package,
  UtensilsCrossed,
  Gamepad2,
  Bed,
  Shirt,
  Link,
  Sparkles,
  Pill,
  Crown,
  Cookie,
  Coffee,
  Backpack,
  Home,
  ArrowLeft,
  ShoppingBag,
  SlidersHorizontal,
  X,
  ArrowDownUp,
} from 'lucide-react';

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

// iFood-style category bubbles. `tint` is the placeholder background; the
// user can later swap each one for an actual photo (img field).
const categoryIcons: {
  name: string;
  short: string;
  icon: React.ElementType;
  tint: string;
}[] = [
  { name: 'Todos', short: 'Todos', icon: Package, tint: '#E8F8EE' },
  { name: 'Ração', short: 'Ração', icon: UtensilsCrossed, tint: '#FFE9D6' },
  { name: 'Brinquedos', short: 'Brinq.', icon: Gamepad2, tint: '#E6EEFF' },
  { name: 'Caminhas', short: 'Caminhas', icon: Bed, tint: '#FFE3EC' },
  { name: 'Roupas', short: 'Roupas', icon: Shirt, tint: '#F0E4FF' },
  { name: 'Coleiras e Guias', short: 'Coleiras', icon: Link, tint: '#DFF4FF' },
  { name: 'Higiene e Cuidados', short: 'Higiene', icon: Sparkles, tint: '#FFF6CC' },
  { name: 'Medicamentos', short: 'Saúde', icon: Pill, tint: '#FFD9D9' },
  { name: 'Acessórios', short: 'Acess.', icon: Crown, tint: '#FFEAB8' },
  { name: 'Petiscos', short: 'Petiscos', icon: Cookie, tint: '#F4E1C1' },
  { name: 'Comedouros e Bebedouros', short: 'Tigelas', icon: Coffee, tint: '#E0F0E8' },
  { name: 'Transporte', short: 'Transp.', icon: Backpack, tint: '#DCE7E0' },
  { name: 'Casa e Canil', short: 'Casa', icon: Home, tint: '#E4E4F8' },
];

const Petshop = () => {
  const navigate = useNavigate();
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [filtersOpen, setFiltersOpen] = useState(false);
  type SortKey = 'recent' | 'price_asc' | 'price_desc' | 'name_asc';
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [onlyInStock, setOnlyInStock] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let isDown = false;
    let startX: number;
    let scrollLeft: number;

    const onMouseDown = (e: MouseEvent) => {
      isDown = true;
      el.style.cursor = 'grabbing';
      startX = e.pageX - el.offsetLeft;
      scrollLeft = el.scrollLeft;
    };

    const onMouseLeave = () => {
      isDown = false;
      el.style.cursor = 'grab';
    };

    const onMouseUp = () => {
      isDown = false;
      el.style.cursor = 'grab';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - el.offsetLeft;
      const walk = (x - startX) * 2;
      el.scrollLeft = scrollLeft - walk;
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mouseleave', onMouseLeave);
    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('mousemove', onMouseMove);

    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mouseleave', onMouseLeave);
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const { data: productsData } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (!productsData || productsData.length === 0) {
        setProducts([]);
        return;
      }

      const petshopIds = [...new Set(productsData.map(p => p.petshop_id))];
      const productIds = productsData.map(p => p.id);

      const [{ data: profilesData }, { data: imagesData }, { data: inventoryData }] = await Promise.all([
        supabase.rpc('get_public_profiles', { user_ids: petshopIds }),
        supabase.from('product_images').select('product_id, image_url').in('product_id', productIds),
        supabase.from('inventory').select('product_id, quantity').in('product_id', productIds),
      ]);

      const productsWithDetails = productsData.map(product => ({
        ...product,
        product_images: imagesData?.filter(img => img.product_id === product.id) || [],
        inventory: inventoryData?.find(inv => inv.product_id === product.id) ? { quantity: inventoryData.find(inv => inv.product_id === product.id)!.quantity } : null,
        profiles: profilesData?.find(p => p.id === product.petshop_id) || null,
      }));

      setProducts(productsWithDetails as Product[]);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  const term = searchTerm.trim().toLowerCase();
  const min = minPrice ? parseFloat(minPrice.replace(',', '.')) : null;
  const max = maxPrice ? parseFloat(maxPrice.replace(',', '.')) : null;

  const filteredProducts = products
    .filter((product) => {
      const matchesSearch =
        !term ||
        product.name.toLowerCase().includes(term) ||
        product.description?.toLowerCase().includes(term) ||
        product.category?.toLowerCase().includes(term) ||
        product.profiles?.full_name?.toLowerCase().includes(term);
      const matchesCategory =
        selectedCategory === 'Todos' || product.category === selectedCategory;
      const hasStock = !onlyInStock || !product.inventory || product.inventory.quantity > 0;
      const matchesMin = min == null || product.price >= min;
      const matchesMax = max == null || product.price <= max;
      return matchesSearch && matchesCategory && hasStock && matchesMin && matchesMax;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'price_asc':
          return a.price - b.price;
        case 'price_desc':
          return b.price - a.price;
        case 'name_asc':
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

  const activeFilterCount =
    (sortBy !== 'recent' ? 1 : 0) +
    (minPrice ? 1 : 0) +
    (maxPrice ? 1 : 0) +
    (onlyInStock ? 0 : 1);

  const clearFilters = () => {
    setSortBy('recent');
    setMinPrice('');
    setMaxPrice('');
    setOnlyInStock(true);
  };

  return (
    <div
      className="min-h-screen flex flex-col max-w-md mx-auto relative"
      style={{ background: PAPER, color: INK, fontFamily: 'DM Sans, sans-serif' }}
    >
      <div className="flex-1 pb-28">
        {/* Editorial top bar */}
        <div className="px-5 pt-6 pb-2 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            aria-label="Voltar"
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{ border: `1px solid ${INK}26`, color: INK }}
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2.2} />
          </button>
          <span
            className="text-[10px] font-bold uppercase tracking-[0.28em]"
            style={{ opacity: 0.55 }}
          >
            Marketplace
          </span>
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: BRAND, color: '#0B1410' }}
          >
            <ShoppingBag className="w-4 h-4" strokeWidth={2.4} />
          </div>
        </div>

        {/* Headline */}
        <div className="px-5 pt-3 pb-5">
          <h1
            className="font-bold leading-[0.92]"
            style={{
              fontFamily: 'Space Grotesk, sans-serif',
              fontSize: 'clamp(36px, 11vw, 46px)',
              letterSpacing: '-0.04em',
            }}
          >
            PetShop
          </h1>
          <p className="mt-3 text-[13px] max-w-[80%]" style={{ opacity: 0.6 }}>
            Tudo pro seu pet, de quem entende.
          </p>
        </div>

        {/* Search + Filters */}
        <div className="px-5 flex items-center gap-2.5">
          <label
            className="flex items-center gap-2.5 px-4 flex-1 min-w-0"
            style={{
              background: PAPER,
              border: `1px solid ${INK}1F`,
              borderRadius: 999,
              height: 48,
            }}
          >
            <Search className="w-4 h-4 flex-shrink-0" style={{ opacity: 0.55 }} />
            <input
              type="text"
              placeholder="Buscar produtos, marcas…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 min-w-0 bg-transparent outline-none text-[14px]"
              style={{ color: INK, fontFamily: 'DM Sans, sans-serif' }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                aria-label="Limpar busca"
                className="flex-shrink-0 active:scale-90 transition-transform"
                style={{ color: INK, opacity: 0.5 }}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </label>
          <button
            onClick={() => setFiltersOpen(true)}
            aria-label="Filtros"
            className="relative w-12 h-12 rounded-full flex items-center justify-center active:scale-90 transition-transform flex-shrink-0"
            style={{
              background: activeFilterCount > 0 ? BRAND : PAPER,
              border: `1px solid ${activeFilterCount > 0 ? BRAND : INK + '26'}`,
              color: activeFilterCount > 0 ? '#0B1410' : INK,
            }}
          >
            <SlidersHorizontal className="w-4 h-4" strokeWidth={2.2} />
            {activeFilterCount > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold"
                style={{ background: '#0B1410', color: BRAND }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Categories — iFood-style circular bubbles, scroll horizontal */}
        <div
          ref={scrollRef}
          className="mt-5 flex gap-3.5 overflow-x-auto overflow-y-hidden pb-5 pt-1 px-5 scrollbar-hide select-none"
          style={{
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            cursor: 'grab',
          }}
        >
          {categoryIcons.map((cat) => {
            const Icon = cat.icon;
            const isActive = selectedCategory === cat.name;
            return (
              <button
                key={cat.name}
                onClick={() => setSelectedCategory(cat.name)}
                className="flex-shrink-0 flex flex-col items-center gap-1.5 active:scale-95 transition-transform"
                style={{ width: 62, scrollSnapAlign: 'start' }}
              >
                <div
                  className="relative w-[62px] h-[62px] rounded-full flex items-center justify-center overflow-hidden"
                  style={{
                    background: cat.tint,
                    border: isActive ? `2.5px solid ${BRAND}` : `2.5px solid transparent`,
                    boxShadow: isActive
                      ? '0 8px 18px -10px rgba(49,216,128,0.6)'
                      : 'none',
                    transition: 'all .2s ease',
                  }}
                >
                  <Icon
                    className="w-7 h-7"
                    strokeWidth={2}
                    style={{ color: '#0B1410', opacity: 0.78 }}
                  />
                  {isActive && (
                    <span
                      className="absolute inset-0"
                      style={{
                        background: `${BRAND}1F`,
                      }}
                    />
                  )}
                </div>
                <span
                  className="text-[11px] font-semibold text-center leading-tight"
                  style={{
                    color: INK,
                    opacity: isActive ? 1 : 0.7,
                    fontFamily: 'Space Grotesk, sans-serif',
                  }}
                >
                  {cat.short}
                </span>
              </button>
            );
          })}
        </div>

        {/* Products */}
        <div className="px-5 pt-1">
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse"
                  style={{
                    background: `${INK}0F`,
                    borderRadius: 22,
                  }}
                />
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div
              className="text-center py-14"
              style={{
                background: PAPER,
                border: `1px dashed ${INK}33`,
                borderRadius: 24,
              }}
            >
              <div
                className="w-14 h-14 rounded-full mx-auto flex items-center justify-center mb-4"
                style={{ background: BRAND, color: '#0B1410' }}
              >
                <Package className="w-6 h-6" strokeWidth={2.2} />
              </div>
              <h3
                className="font-bold mb-1.5"
                style={{
                  fontFamily: 'Space Grotesk, sans-serif',
                  fontSize: 18,
                  letterSpacing: '-0.01em',
                }}
              >
                {searchTerm || selectedCategory !== 'Todos'
                  ? 'Nada encontrado'
                  : 'Sem produtos ainda'}
              </h3>
              <p className="text-[12px]" style={{ opacity: 0.6 }}>
                {searchTerm || selectedCategory !== 'Todos'
                  ? 'Tente ajustar os filtros.'
                  : 'Volte em breve.'}
              </p>
              {(searchTerm || selectedCategory !== 'Todos') && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedCategory('Todos');
                  }}
                  className="mt-4 text-[11px] font-bold uppercase tracking-[0.22em]"
                  style={{ color: BRAND }}
                >
                  Limpar filtros →
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onClick={() => navigate(`/product/${product.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <BottomNavigation />

      {/* Filter Sheet */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side="bottom"
          className="border-0 p-0 max-w-md mx-auto"
          style={{
            background: PAPER,
            color: INK,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            fontFamily: 'DM Sans, sans-serif',
          }}
        >
          <div className="px-6 pt-5 pb-8">
            <div
              className="mx-auto mb-4 rounded-full"
              style={{ width: 44, height: 4, background: `${INK}26` }}
            />
            <SheetHeader className="text-left space-y-1 mb-5">
              <SheetTitle
                style={{
                  fontFamily: 'Space Grotesk, sans-serif',
                  color: INK,
                  fontSize: 26,
                  letterSpacing: '-0.02em',
                }}
              >
                Filtros
              </SheetTitle>
              <SheetDescription style={{ color: INK, opacity: 0.6 }}>
                Refine sua busca no marketplace.
              </SheetDescription>
            </SheetHeader>

            {/* Sort */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <ArrowDownUp className="w-3.5 h-3.5" style={{ opacity: 0.6 }} />
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.24em]"
                  style={{ opacity: 0.6 }}
                >
                  Ordenar por
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { k: 'recent', label: 'Mais recentes' },
                  { k: 'price_asc', label: 'Menor preço' },
                  { k: 'price_desc', label: 'Maior preço' },
                  { k: 'name_asc', label: 'Nome A-Z' },
                ] as { k: SortKey; label: string }[]).map((opt) => {
                  const active = sortBy === opt.k;
                  return (
                    <button
                      key={opt.k}
                      onClick={() => setSortBy(opt.k)}
                      className="h-11 px-3 rounded-full text-[13px] font-semibold active:scale-95 transition-transform"
                      style={{
                        background: active ? INK : 'transparent',
                        color: active ? PAPER : INK,
                        border: `1px solid ${active ? INK : INK + '26'}`,
                        fontFamily: 'Space Grotesk, sans-serif',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Price range */}
            <div className="mb-6">
              <span
                className="text-[10px] font-bold uppercase tracking-[0.24em] block mb-3"
                style={{ opacity: 0.6 }}
              >
                Faixa de preço (R$)
              </span>
              <div className="flex items-center gap-2 w-full">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Mín"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  className="flex-1 min-w-0 w-full h-12 px-4 bg-transparent outline-none text-[14px]"
                  style={{
                    border: `1px solid ${INK}1F`,
                    borderRadius: 999,
                    color: INK,
                  }}
                />
                <span className="flex-shrink-0" style={{ opacity: 0.4 }}>—</span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Máx"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  className="flex-1 min-w-0 w-full h-12 px-4 bg-transparent outline-none text-[14px]"
                  style={{
                    border: `1px solid ${INK}1F`,
                    borderRadius: 999,
                    color: INK,
                  }}
                />
              </div>
            </div>

            {/* Stock toggle */}
            <label
              className="flex items-center justify-between mb-6 cursor-pointer"
              style={{
                border: `1px solid ${INK}1F`,
                borderRadius: 22,
                padding: '14px 18px',
              }}
            >
              <div>
                <div
                  className="font-bold text-[14px]"
                  style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                >
                  Apenas em estoque
                </div>
                <div className="text-[11px] mt-0.5" style={{ opacity: 0.6 }}>
                  Esconder produtos esgotados
                </div>
              </div>
              <span
                className="relative inline-block"
                style={{
                  width: 44,
                  height: 26,
                  borderRadius: 999,
                  background: onlyInStock ? BRAND : `${INK}26`,
                  transition: 'background .2s',
                }}
              >
                <input
                  type="checkbox"
                  checked={onlyInStock}
                  onChange={(e) => setOnlyInStock(e.target.checked)}
                  className="sr-only"
                />
                <span
                  className="absolute top-[3px] rounded-full bg-white"
                  style={{
                    width: 20,
                    height: 20,
                    left: onlyInStock ? 21 : 3,
                    transition: 'left .2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </span>
            </label>

            <SheetFooter className="flex-row gap-2 sm:gap-2">
              <button
                onClick={clearFilters}
                className="flex-1 h-12 rounded-full text-[13px] font-bold active:scale-95 transition-transform"
                style={{
                  border: `1px solid ${INK}26`,
                  color: INK,
                  fontFamily: 'Space Grotesk, sans-serif',
                }}
              >
                Limpar
              </button>
              <button
                onClick={() => setFiltersOpen(false)}
                className="flex-1 h-12 rounded-full text-[13px] font-bold active:scale-95 transition-transform"
                style={{
                  background: BRAND,
                  color: '#0B1410',
                  fontFamily: 'Space Grotesk, sans-serif',
                }}
              >
                Ver {filteredProducts.length} {filteredProducts.length === 1 ? 'item' : 'itens'}
              </button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Petshop;
