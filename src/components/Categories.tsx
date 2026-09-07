import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import funcPasseio from '@/assets/func-passeio.png';
import funcVet from '@/assets/func-vet.png';
import funcPetshop from '@/assets/func-petshop.png';
import funcHotel from '@/assets/func-hotel.png';

const services = [
  { title: 'Passeios', cta: 'Iniciar', route: '/search-walk', image: funcPasseio },
  { title: 'Veterinário', cta: 'Ir', route: '/veterinario', image: funcVet },
  { title: 'PetShop', cta: 'Navegar', route: '/petshop', image: funcPetshop },
  { title: 'Hotéis', cta: 'Ir', route: '/hotelaria', image: funcHotel },
];

// Triple the array for infinite illusion
const tripled = [...services, ...services, ...services];
const ORIGINAL_LEN = services.length;

interface CategoriesProps {
  onCategoryChange?: (title: string) => void;
}

export const Categories = ({ onCategoryChange }: CategoriesProps = {}) => {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [centerIndex, setCenterIndex] = useState(ORIGINAL_LEN); // start at second set
  const isAdjusting = useRef(false);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollStart = useRef(0);
  const hasDragged = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartScroll = useRef(0);

  const CARD_WIDTH_PERCENT = 0.78;
  const GAP = -12;

  // Mouse drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    hasDragged.current = false;
    startX.current = e.pageX;
    scrollStart.current = scrollRef.current?.scrollLeft ?? 0;
    if (scrollRef.current) scrollRef.current.style.cursor = 'grabbing';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !scrollRef.current) return;
    e.preventDefault();
    const dx = e.pageX - startX.current;
    if (Math.abs(dx) > 3) hasDragged.current = true;
    scrollRef.current.scrollLeft = scrollStart.current - dx;
  };

  const handleMouseUp = () => {
    isDragging.current = false;
    if (scrollRef.current) scrollRef.current.style.cursor = 'grab';
  };

  const getCardWidth = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return 200;
    return el.clientWidth * CARD_WIDTH_PERCENT;
  }, []);

  const scrollToIndex = useCallback((index: number, smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = getCardWidth();
    const containerCenter = el.clientWidth / 2;
    const targetCardCenter = index * (cardWidth + GAP) + cardWidth / 2;
    el.scrollTo({ left: targetCardCenter - containerCenter, behavior: smooth ? 'smooth' : 'auto' });
  }, [getCardWidth]);

  // Touch handlers: force one-by-one paging regardless of swipe strength
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartScroll.current = scrollRef.current?.scrollLeft ?? 0;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    const THRESHOLD = 30;
    if (Math.abs(dx) < THRESHOLD) {
      scrollToIndex(centerIndex);
      return;
    }
    const direction = dx < 0 ? 1 : -1;
    scrollToIndex(centerIndex + direction);
  };

  // Scroll to the initial center card (first item of the middle set)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = getCardWidth();
    const containerCenter = el.clientWidth / 2;
    const targetCardCenter = ORIGINAL_LEN * (cardWidth + GAP) + cardWidth / 2;
    el.scrollLeft = targetCardCenter - containerCenter;
  }, [getCardWidth]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      if (isAdjusting.current) return;

      const scrollLeft = el.scrollLeft;
      const containerWidth = el.clientWidth;
      const cardWidth = containerWidth * CARD_WIDTH_PERCENT;
      const center = scrollLeft + containerWidth / 2;

      // Find closest card
      let closest = 0;
      let minDist = Infinity;
      tripled.forEach((_, i) => {
        const cardCenter = i * (cardWidth + GAP) + cardWidth / 2;
        const dist = Math.abs(center - cardCenter);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      });

      setCenterIndex(closest);

      // Infinite loop: jump seamlessly when reaching edges
      const totalOneSet = ORIGINAL_LEN * (cardWidth + GAP);
      if (scrollLeft < totalOneSet * 0.3) {
        isAdjusting.current = true;
        el.scrollLeft = scrollLeft + totalOneSet;
        requestAnimationFrame(() => { isAdjusting.current = false; });
      } else if (scrollLeft > totalOneSet * 1.7) {
        isAdjusting.current = true;
        el.scrollLeft = scrollLeft - totalOneSet;
        requestAnimationFrame(() => { isAdjusting.current = false; });
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const realIndex = centerIndex % ORIGINAL_LEN;

  useEffect(() => {
    onCategoryChange?.(services[realIndex].title);
  }, [realIndex, onCategoryChange]);

  return (
    <div className="mb-5">
      <div className="px-5 flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Funções</h2>
      </div>

      <div
        ref={scrollRef}
        className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory select-none"
        style={{ gap: `${GAP}px`, paddingLeft: '20px', paddingRight: '20px', cursor: 'grab', overscrollBehaviorX: 'contain' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {tripled.map((service, index) => {
          const isCenter = index === centerIndex;
          return (
            <div
              key={index}
              className="flex-shrink-0 rounded-[36px] overflow-hidden relative cursor-pointer snap-center snap-always transition-all duration-300 ease-out"
              style={{
                width: '82%',
                height: isCenter ? 380 : 320,
                transform: isCenter ? 'scale(1)' : 'scale(0.88)',
                opacity: isCenter ? 1 : 0.5,
                filter: isCenter ? 'none' : 'brightness(0.7)',
              }}
              onClick={() => { if (!hasDragged.current) navigate(service.route); }}
            >
              {/* Background image */}
              <img
                src={service.image}
                alt={service.title}
                className="w-full h-full object-cover"
              />

              {/* Gradient overlay */}
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.02) 50%, rgba(0,0,0,0.55) 100%)',
                }}
              />

              {/* Top-left: Function name */}
              <div className="absolute top-4 left-5">
                <span className="text-white text-lg font-extrabold drop-shadow-lg">
                  {service.title}
                </span>
              </div>

              {/* Top-right: Bookmark button */}
              <div className="absolute top-4 right-4">
                <button
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(10px)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Bookmark className="w-[18px] h-[18px] text-white" />
                </button>
              </div>

              {/* Bottom: CTA button */}
              <div className="absolute bottom-5 left-0 right-0 flex justify-center">
                <button
                  className="px-10 py-3 rounded-full text-sm font-bold shadow-xl transition-transform active:scale-95"
                  style={{
                    background: 'rgba(255,255,255,0.95)',
                    color: '#0B1410',
                    boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(service.route);
                  }}
                >
                  {service.cta}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dots indicator */}
      <div className="flex justify-center gap-1.5 mt-3">
        {services.map((_, i) => (
          <div
            key={i}
            className="rounded-full transition-all duration-300"
            style={{
              width: i === realIndex ? 20 : 6,
              height: 6,
              backgroundColor: i === realIndex ? '#F14A00' : 'hsl(var(--muted))',
            }}
          />
        ))}
      </div>
    </div>
  );
};
