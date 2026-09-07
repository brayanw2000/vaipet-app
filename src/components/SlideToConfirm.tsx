import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { haptic } from '@/lib/native';

interface SlideToConfirmProps {
  label: string;
  onConfirm: () => void;
  petAvatar?: string | null;
  petAvatars?: (string | null | undefined)[];
  petName?: string;
  isDarkMode?: boolean;
  disabled?: boolean;
}

/**
 * iOS-style "slide to confirm" button. The draggable thumb shows the
 * selected pet's photo. Sliding all the way to the right triggers
 * `onConfirm`.
 */

export const SlideToConfirm: React.FC<SlideToConfirmProps> = ({
  label,
  onConfirm,
  petAvatar,
  petAvatars,
  petName,
  isDarkMode = false,
  disabled = false,
}) => {
  const avatarsList = (petAvatars && petAvatars.length > 0 ? petAvatars : [petAvatar]).filter(Boolean) as string[];
  const isMulti = avatarsList.length > 1;
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0); // 0..1
  const [confirmed, setConfirmed] = useState(false);
  const startX = useRef<number | null>(null);
  const maxRef = useRef(0);
  const hapticTickRef = useRef(0);

  const THUMB = 52; // px

  useEffect(() => {
    const recompute = () => {
      if (trackRef.current) maxRef.current = Math.max(0, trackRef.current.clientWidth - THUMB - 8);
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, []);

  const end = (committed: boolean) => {
    startX.current = null;
    if (committed) {
      setDrag(1);
      setConfirmed(true);
      haptic.success();
      setTimeout(onConfirm, 180);
    } else {
      setDrag(0);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || confirmed) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    haptic.light();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current == null || maxRef.current === 0) return;
    const dx = e.clientX - startX.current;
    const ratio = Math.max(0, Math.min(1, dx / maxRef.current));
    setDrag(ratio);
    // Pequeno "tick" tátil enquanto o usuário arrasta — passa por 4 marcos.
    const tick = Math.floor(ratio * 4);
    if (tick !== hapticTickRef.current) {
      hapticTickRef.current = tick;
      if (tick > 0) haptic.selection();
    }
  };
  const onPointerUp = () => {
    if (startX.current == null) return;
    end(drag > 0.85);
  };

  // Editorial palette
  const INK = '#0B1410';
  const PAPER = '#F7F5EF';
  const BRAND = '#31D880';

  const trackBg = isDarkMode ? '#0B1410' : PAPER;
  const trackBorder = isDarkMode ? 'rgba(247,245,239,0.08)' : 'rgba(11,20,16,0.08)';
  const labelColor = isDarkMode ? 'rgba(247,245,239,0.45)' : 'rgba(11,20,16,0.45)';
  const labelColorOnFill = INK;

  const fillPct = Math.max(drag, confirmed ? 1 : 0);

  return (
    <div
      data-testid="slide-to-confirm"
      data-testid-track="slide-to-confirm-track"
      ref={trackRef}
      className="relative w-full h-[62px] overflow-hidden select-none touch-none"
      style={{
        background: trackBg,
        border: `1px solid ${trackBorder}`,
        borderRadius: 20,
      }}
    >
      {/* progress fill (solid brand green, no gradient — editorial) */}
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-150"
        style={{
          width: `${fillPct * 100}%`,
          background: BRAND,
        }}
      />

      {/* label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none pl-14 pr-8">
        <span
          className="text-[14px] tracking-tight transition-opacity truncate"
          style={{
            fontFamily: '"Space Grotesk", system-ui, sans-serif',
            fontWeight: 700,
            color: fillPct > 0.45 ? labelColorOnFill : labelColor,
            opacity: confirmed ? 0 : 1,
          }}
        >
          {confirmed ? 'buscando...' : label}
        </span>
      </div>

      {/* arrow hint — subtle pulse */}
      <div
        className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none animate-pulse"
        style={{ opacity: confirmed ? 0 : Math.max(0, 0.4 - fillPct * 2) }}
      >
        <ArrowRight className="w-[18px] h-[18px]" style={{ color: labelColor }} strokeWidth={2.4} />
      </div>

      {/* thumb */}
      <div
        data-testid-handle="slide-to-confirm-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          if (!disabled && !confirmed && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            end(true);
          }
        }}
        tabIndex={disabled || confirmed ? -1 : 0}
        aria-label={label}
        role="button"

        className="absolute top-1 left-1 flex items-center justify-center cursor-grab active:cursor-grabbing group shadow-sm active:shadow-md"
        style={{
          width: THUMB,
          height: THUMB,
          transform: `translateX(${drag * maxRef.current}px)`,
          transition: startX.current == null ? 'transform 320ms cubic-bezier(0.23, 1, 0.32, 1)' : 'none',
          background: avatarsList.length > 0 ? INK : BRAND,
          borderRadius: 16,
        }}
      >
        {confirmed ? (
          <Check className="w-5 h-5" style={{ color: BRAND }} strokeWidth={3} />
        ) : isMulti ? (
          <div className="relative w-[42px] h-[42px] flex items-center justify-center">
            <div className="flex items-center">
              {avatarsList.slice(0, 3).map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`pet ${i + 1}`}
                  className="object-cover"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 10,
                    border: `2px solid ${INK}`,
                    marginLeft: i === 0 ? 0 : -10,
                    zIndex: 10 - i,
                  }}
                  draggable={false}
                />
              ))}
            </div>
            <div
              className="absolute -right-1 -bottom-1 min-w-5 h-5 px-1 flex items-center justify-center shadow-lg"
              style={{ background: BRAND, borderRadius: 8, border: `2px solid ${INK}`, color: INK, fontFamily: '"Space Grotesk", system-ui, sans-serif', fontWeight: 800, fontSize: 10, lineHeight: 1 }}
            >
              {avatarsList.length}
            </div>
          </div>
        ) : avatarsList[0] ? (
          <div className="relative w-[42px] h-[42px]">
            <img
              src={avatarsList[0]}
              alt={petName || 'pet'}
              className="w-full h-full object-cover"
              style={{ borderRadius: 12 }}
              draggable={false}
            />
            <div
              className="absolute -right-1 -bottom-1 w-5 h-5 flex items-center justify-center shadow-lg"
              style={{ background: BRAND, borderRadius: 8, border: `2px solid ${INK}` }}
            >
              <ArrowRight className="w-2.5 h-2.5" style={{ color: INK }} strokeWidth={4} />
            </div>
          </div>
        ) : (
          <div
            className="w-[42px] h-[42px] flex items-center justify-center text-base"
            style={{
              color: INK,
              fontFamily: '"Space Grotesk", system-ui, sans-serif',
              fontWeight: 800,
            }}
          >
            {petName?.[0]?.toUpperCase() || <ArrowRight className="w-5 h-5" strokeWidth={3} />}
          </div>
        )}
      </div>
    </div>
  );
};
