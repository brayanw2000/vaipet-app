import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { X, ArrowRight } from 'lucide-react';

/**
 * Tour guiado da Home.
 *
 * O componente original posicionava o tooltip com `window.innerHeight` e
 * coordenadas simples: no Safari/iPhone a etapa "Pedir Passeio" (cujo alvo
 * fica na navegação inferior fixa) aparecia atrás da barra do navegador e
 * "andava" junto com a rolagem.
 *
 * Agora:
 *  - usa `window.visualViewport` (offsetTop/offsetLeft/width/height) quando
 *    disponível, com fallback para `window`;
 *  - tooltip e spotlight são `position: fixed` e ficam sempre dentro da
 *    visual viewport, com margem mínima de 16px;
 *  - recalcula via `requestAnimationFrame` em troca de etapa, resize e scroll
 *    (inclusive eventos do visualViewport);
 *  - bloqueia a rolagem do conteúdo de fundo e restaura o estilo anterior;
 *  - nunca fecha por toque acidental no backdrop — só "Pular", X ou finalizar.
 */

export interface TourStep {
  targetId: string;
  title: string;
  description: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    targetId: 'tour-pet-chips',
    title: 'Seus Pets',
    description: 'Aqui você vê seus pets e adiciona novos.',
  },
  {
    targetId: 'tour-nav-walk',
    title: 'Pedir Passeio',
    description: 'Encontre um passeador agora mesmo.',
  },
  {
    targetId: 'tour-history',
    title: 'Histórico',
    description: 'Veja os detalhes de passeios passados.',
  },
  {
    targetId: 'tour-nav-shop',
    title: 'Pet Shop',
    description: 'Produtos e serviços para o seu pet.',
  },
];

export const TOUR_STORAGE_KEY = 'vaipet_tour_seen';
export const TOUR_ONBOARDING_KEY = 'vaipet_onboarding_just_finished';
/** Margem mínima entre o tooltip e as bordas da visual viewport. */
export const TOUR_VIEWPORT_MARGIN = 16;
/** Tentativas (frames) antes de desistir de um alvo inexistente. */
export const MAX_TARGET_MISSES = 10;
/** Tamanho estimado do tooltip quando ainda não foi medido. */
export const TOOLTIP_FALLBACK_SIZE = { width: 280, height: 180 };

export interface TourViewport {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TourPosition extends TourRect {
  placement: 'above' | 'below';
}

/** Visual viewport real (Safari/iPhone) com fallback para a window. */
export const getTourViewport = (): TourViewport => {
  if (typeof window === 'undefined') return { top: 0, left: 0, width: 0, height: 0 };
  const vv = window.visualViewport;
  if (vv) {
    return {
      top: vv.offsetTop ?? 0,
      left: vv.offsetLeft ?? 0,
      width: vv.width,
      height: vv.height,
    };
  }
  return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Calcula a posição do tooltip dentro da visual viewport.
 * Coloca acima quando não há espaço abaixo e o espaço acima é maior, e limita
 * top/left para nunca sair da viewport (margem mínima de 16px).
 */
export const computeTooltipPosition = (
  target: TourRect,
  tooltip: { width: number; height: number },
  viewport: TourViewport,
  margin: number = TOUR_VIEWPORT_MARGIN,
): TourPosition => {
  const spaceAbove = target.top - viewport.top;
  const spaceBelow = viewport.top + viewport.height - (target.top + target.height);
  const needed = tooltip.height + margin;
  const placeAbove = spaceBelow < needed && spaceAbove >= spaceBelow;

  const top = placeAbove
    ? target.top - tooltip.height - margin
    : target.top + target.height + margin;
  const left = target.left + target.width / 2 - tooltip.width / 2;

  return {
    top: clamp(
      top,
      viewport.top + margin,
      viewport.top + viewport.height - tooltip.height - margin,
    ),
    left: clamp(
      left,
      viewport.left + margin,
      viewport.left + viewport.width - tooltip.width - margin,
    ),
    width: tooltip.width,
    height: tooltip.height,
    placement: placeAbove ? 'above' : 'below',
  };
};

export const GuidedTour: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<TourPosition | null>(null);
  const [targetRect, setTargetRect] = useState<TourRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const previousBodyOverflowRef = useRef<string | null>(null);
  const previousHtmlOverflowRef = useRef<string | null>(null);
  const { palette } = useHomeTheme();

  const finishTour = useCallback(() => {
    setIsVisible(false);
    setPosition(null);
    setTargetRect(null);
    localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    sessionStorage.removeItem(TOUR_ONBOARDING_KEY);
  }, []);

  // Abertura automática após o onboarding (comportamento original preservado).
  useEffect(() => {
    const hasSeenTour = localStorage.getItem(TOUR_STORAGE_KEY);
    const onboardingJustFinished = sessionStorage.getItem(TOUR_ONBOARDING_KEY);

    if (!hasSeenTour && onboardingJustFinished) {
      const timer = setTimeout(() => setIsVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  // Bloqueia a rolagem do fundo durante o tour e restaura o estilo anterior.
  useEffect(() => {
    if (!isVisible) return;
    previousBodyOverflowRef.current = document.body.style.overflow;
    previousHtmlOverflowRef.current = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflowRef.current ?? '';
      document.documentElement.style.overflow = previousHtmlOverflowRef.current ?? '';
      previousBodyOverflowRef.current = null;
      previousHtmlOverflowRef.current = null;
    };
  }, [isVisible]);

  // Mede o alvo + o tooltip e reposiciona. Recalcula em troca de etapa,
  // resize, scroll e eventos do visualViewport.
  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;
    let frame: number | null = null;
    let misses = 0;

    const schedule = () => {
      if (cancelled || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };

    const measure = () => {
      if (cancelled) return;

      const el = document.getElementById(TOUR_STEPS[currentStep].targetId);
      if (!el) {
        misses += 1;
        if (misses > MAX_TARGET_MISSES) {
          // Não mostramos tooltip em (0,0): avança com segurança ou encerra.
          if (currentStep < TOUR_STEPS.length - 1) setCurrentStep(currentStep + 1);
          else finishTour();
          return;
        }
        schedule();
        return;
      }
      misses = 0;

      const rect = el.getBoundingClientRect();
      const tooltipSize = tooltipRef.current
        ? {
            width: tooltipRef.current.getBoundingClientRect().width,
            height: tooltipRef.current.getBoundingClientRect().height,
          }
        : null;

      const size =
        tooltipSize && tooltipSize.width > 0 && tooltipSize.height > 0
          ? tooltipSize
          : TOOLTIP_FALLBACK_SIZE;

      const nextPosition = computeTooltipPosition(rect, size, getTourViewport());
      if (cancelled) return;
      setTargetRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
      setPosition(nextPosition);
    };

    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);

    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
    };
  }, [isVisible, currentStep, finishTour]);

  const handleNext = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (currentStep < TOUR_STEPS.length - 1) setCurrentStep((prev) => prev + 1);
    else finishTour();
  };

  const handleClose = (event?: React.MouseEvent) => {
    event?.stopPropagation();
    finishTour();
  };

  if (!isVisible) return null;

  const step = TOUR_STEPS[currentStep];
  const isLast = currentStep === TOUR_STEPS.length - 1;
  const placement = position?.placement ?? 'below';

  return (
    <div className="fixed inset-0 z-[200]" data-testid="guided-tour">
      {/* Backdrop — não fecha ao toque (fechamento só por Pular/X/finalizar). */}
      <div
        className="absolute inset-0 bg-[#0B1410]/60 backdrop-blur-[2px]"
        data-testid="guided-tour-backdrop"
        aria-hidden="true"
      />

      {/* Spotlight sobre o alvo atual. */}
      {targetRect && (
        <div
          aria-hidden="true"
          data-testid="guided-tour-spotlight"
          className="fixed z-[205] rounded-2xl pointer-events-none ring-[2000px] ring-[#0B1410]/80"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-title"
        data-testid="guided-tour-tooltip"
        data-placement={placement}
        onClick={(event) => event.stopPropagation()}
        className="fixed z-[210] w-[calc(100vw-32px)] max-w-[280px] rounded-[32px] p-6 shadow-2xl"
        style={{
          background: palette.paper,
          color: palette.ink,
          top: position?.top ?? 0,
          left: position?.left ?? 0,
          opacity: position ? 1 : 0,
          visibility: position ? 'visible' : 'hidden',
          transition: 'top 200ms ease, left 200ms ease',
        }}
      >
        <div
          aria-hidden="true"
          className="absolute left-1/2 -translate-x-1/2 w-4 h-4 rotate-45"
          style={{
            background: palette.paper,
            top: placement === 'below' ? -8 : 'auto',
            bottom: placement === 'above' ? -8 : 'auto',
          }}
        />

        <div className="flex items-start justify-between gap-3 mb-1.5">
          <h3
            id="guided-tour-title"
            className="text-lg font-bold"
            style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          >
            {step.title}
          </h3>
          <button
            onClick={handleClose}
            aria-label="Fechar tutorial"
            className="shrink-0 -mt-1 -mr-1 w-7 h-7 rounded-full flex items-center justify-center opacity-50 hover:opacity-100 transition-opacity"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-[15px] opacity-80 leading-relaxed mb-6">
          {step.description}
        </p>

        <div className="flex items-center justify-between">
          <button
            onClick={handleClose}
            className="text-xs font-medium opacity-50 hover:opacity-100 transition-opacity"
          >
            Pular
          </button>
          <button
            onClick={handleNext}
            className="flex items-center gap-2 py-2 px-4 rounded-full text-xs font-bold active:scale-95 transition-all shadow-md shadow-[#31D880]/20"
            style={{ background: '#31D880', color: '#0B1410' }}
          >
            {isLast ? 'Entendi' : 'Próximo'}
            {!isLast && <ArrowRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
};
