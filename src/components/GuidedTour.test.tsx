import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import {
  GuidedTour,
  MAX_TARGET_MISSES,
  TOOLTIP_FALLBACK_SIZE,
  TOUR_ONBOARDING_KEY,
  TOUR_STORAGE_KEY,
  TOUR_VIEWPORT_MARGIN,
  computeTooltipPosition,
  getTourViewport,
} from './GuidedTour';

/**
 * Tour visível no iPhone.
 *
 * O componente antigo posicionava o tooltip com `window.innerHeight` e
 * coordenadas simples: no Safari a etapa "Pedir Passeio" (alvo na navegação
 * inferior fixa) ficava atrás da barra e seguia a rolagem.
 *
 * Aqui validamos a geometria pura e o comportamento real na viewport 390x844.
 */

const VIEWPORT = { width: 390, height: 844 };

const RECTS: Record<string, { top: number; left: number; width: number; height: number }> = {
  'tour-pet-chips': { top: 120, left: 16, width: 300, height: 40 },
  'tour-nav-walk': { top: 780, left: 96, width: 72, height: 50 },
  'tour-history': { top: 60, left: 300, width: 60, height: 40 },
  'tour-nav-shop': { top: 780, left: 260, width: 72, height: 50 },
};

const TOOLTIP_RECT = { top: 0, left: 0, width: 280, height: 180 };

const makeRect = (r: { top: number; left: number; width: number; height: number }) => ({
  top: r.top,
  left: r.left,
  width: r.width,
  height: r.height,
  right: r.left + r.width,
  bottom: r.top + r.height,
  x: r.left,
  y: r.top,
  toJSON: () => ({}),
});

const createVisualViewportMock = () => {
  const listeners: Record<string, Set<() => void>> = {};
  return {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    offsetTop: 0,
    offsetLeft: 0,
    scale: 1,
    pageTop: 0,
    pageLeft: 0,
    addEventListener: vi.fn((type: string, cb: () => void) => {
      (listeners[type] ||= new Set()).add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: () => void) => {
      listeners[type]?.delete(cb);
    }),
    dispatchEvent: vi.fn(() => true),
    __emit: (type: string) => {
      listeners[type]?.forEach((cb) => cb());
    },
    __listeners: listeners,
  };
};

type ViewportMock = ReturnType<typeof createVisualViewportMock>;

let viewportMock: ViewportMock;

const installTargets = () => {
  Object.entries(RECTS).forEach(([id, rect]) => {
    const el = document.createElement('div');
    el.id = id;
    el.getBoundingClientRect = () => makeRect(rect) as DOMRect;
    document.body.appendChild(el);
  });
};

const installRectMeasurement = () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.getAttribute('data-testid') === 'guided-tour-tooltip') {
      return makeRect(TOOLTIP_RECT) as DOMRect;
    }
    return makeRect({ top: 0, left: 0, width: 0, height: 0 }) as DOMRect;
  });
};

const openTour = () => {
  localStorage.removeItem(TOUR_STORAGE_KEY);
  sessionStorage.setItem(TOUR_ONBOARDING_KEY, '1');
  render(<GuidedTour />);
  act(() => {
    vi.advanceTimersByTime(1600);
  });
  act(() => {
    vi.advanceTimersByTime(64);
  });
};

const tooltipBox = () => {
  const tooltip = screen.getByTestId('guided-tour-tooltip');
  return {
    top: Number.parseFloat(tooltip.style.top),
    left: Number.parseFloat(tooltip.style.left),
    height: TOOLTIP_RECT.height,
    width: TOOLTIP_RECT.width,
  };
};

const stepTo = (times: number) => {
  for (let i = 0; i < times; i += 1) {
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Próximo/i }));
    });
    act(() => {
      vi.advanceTimersByTime(64);
    });
  }
};

describe('computeTooltipPosition — geometria da visual viewport', () => {
  const viewport = { top: 0, left: 0, ...VIEWPORT };

  it('coloca o tooltip abaixo quando há espaço e mantém a margem de 16px', () => {
    const pos = computeTooltipPosition(RECTS['tour-pet-chips'], TOOLTIP_FALLBACK_SIZE, viewport);
    expect(pos.placement).toBe('below');
    expect(pos.top).toBe(RECTS['tour-pet-chips'].top + RECTS['tour-pet-chips'].height + TOUR_VIEWPORT_MARGIN);
    expect(pos.left).toBeGreaterThanOrEqual(TOUR_VIEWPORT_MARGIN);
  });

  it('"Pedir Passeio" (navegação inferior fixa) aparece acima da barra', () => {
    const target = RECTS['tour-nav-walk'];
    const pos = computeTooltipPosition(target, TOOLTIP_FALLBACK_SIZE, viewport);
    expect(pos.placement).toBe('above');
    expect(pos.top + pos.height).toBeLessThanOrEqual(target.top);
  });

  it('nunca sai da viewport: as quatro orientações ficam dentro dos limites', () => {
    Object.values(RECTS).forEach((target) => {
      const pos = computeTooltipPosition(target, TOOLTIP_FALLBACK_SIZE, viewport);
      expect(pos.top).toBeGreaterThanOrEqual(viewport.top + TOUR_VIEWPORT_MARGIN);
      expect(pos.top + pos.height).toBeLessThanOrEqual(viewport.height - TOUR_VIEWPORT_MARGIN);
      expect(pos.left).toBeGreaterThanOrEqual(viewport.left + TOUR_VIEWPORT_MARGIN);
      expect(pos.left + pos.width).toBeLessThanOrEqual(viewport.width - TOUR_VIEWPORT_MARGIN);
    });
  });

  it('respeita o offset da visual viewport (teclado / rolagem do Safari)', () => {
    const scrolled = { top: 200, left: 0, ...VIEWPORT };
    const target = { top: 620, left: 100, width: 72, height: 50 };
    const pos = computeTooltipPosition(target, TOOLTIP_FALLBACK_SIZE, scrolled);
    expect(pos.top).toBeGreaterThanOrEqual(scrolled.top + TOUR_VIEWPORT_MARGIN);
    expect(pos.top + pos.height).toBeLessThanOrEqual(scrolled.top + scrolled.height - TOUR_VIEWPORT_MARGIN);
  });

  it('getTourViewport usa window.visualViewport quando disponível', () => {
    const vv = createVisualViewportMock();
    vv.offsetTop = 24;
    vv.offsetLeft = 8;
    Object.defineProperty(window, 'visualViewport', { configurable: true, writable: true, value: vv });
    expect(getTourViewport()).toEqual({ top: 24, left: 8, width: 390, height: 844 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, writable: true, value: undefined });
    expect(getTourViewport()).toEqual({ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight });
  });
});

describe('GuidedTour — comportamento no iPhone (390x844)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    viewportMock = createVisualViewportMock();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      writable: true,
      value: viewportMock,
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT.width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT.height });
    installTargets();
    installRectMeasurement();
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'visible';
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    vi.restoreAllMocks();
  });

  it('percorre as quatro orientações com o tooltip dentro da visual viewport', () => {
    openTour();

    for (let stepIndex = 0; stepIndex < 4; stepIndex += 1) {
      const box = tooltipBox();
      expect(box.top).toBeGreaterThanOrEqual(TOUR_VIEWPORT_MARGIN);
      expect(box.top + box.height).toBeLessThanOrEqual(VIEWPORT.height - TOUR_VIEWPORT_MARGIN);
      expect(box.left).toBeGreaterThanOrEqual(TOUR_VIEWPORT_MARGIN);
      expect(box.left + box.width).toBeLessThanOrEqual(VIEWPORT.width - TOUR_VIEWPORT_MARGIN);
      if (stepIndex < 3) stepTo(1);
    }

    // A última orientação mostra o botão de conclusão.
    expect(screen.getByRole('button', { name: /Entendi/i })).toBeInTheDocument();
  });

  it('"Pedir Passeio" fica acima da navegação inferior', () => {
    openTour();
    stepTo(1); // etapa 2 = "Pedir Passeio"

    expect(screen.getByText('Pedir Passeio')).toBeInTheDocument();
    const box = tooltipBox();
    const nav = RECTS['tour-nav-walk'];
    expect(box.top + box.height).toBeLessThanOrEqual(nav.top);
    expect(screen.getByTestId('guided-tour-tooltip').dataset.placement).toBe('above');
  });

  it('recalcula a posição em resize/scroll da visualViewport', () => {
    openTour();
    const before = tooltipBox().top;

    // Safari: barra/teclado mudam a altura útil e o alvo se desloca.
    RECTS['tour-pet-chips'].top = 400;
    viewportMock.height = 600;
    act(() => {
      viewportMock.__emit('resize');
    });
    act(() => {
      vi.advanceTimersByTime(64);
    });

    const after = tooltipBox();
    expect(after.top).not.toBe(before);
    expect(after.top + after.height).toBeLessThanOrEqual(600 - TOUR_VIEWPORT_MARGIN);

    viewportMock.offsetTop = 20;
    RECTS['tour-pet-chips'].top = 500;
    act(() => {
      viewportMock.__emit('scroll');
    });
    act(() => {
      vi.advanceTimersByTime(64);
    });

    const scrolled = tooltipBox();
    expect(scrolled.top).toBeGreaterThanOrEqual(20 + 16);
    expect(scrolled.top + scrolled.height).toBeLessThanOrEqual(20 + 600 - TOUR_VIEWPORT_MARGIN);
  });

  it('não fecha por toque acidental no backdrop', () => {
    openTour();

    act(() => {
      fireEvent.click(screen.getByTestId('guided-tour-backdrop'));
    });

    expect(screen.getByTestId('guided-tour')).toBeInTheDocument();
    expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
  });

  it('"Pular" fecha o tour e persiste a decisão', () => {
    openTour();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Pular/i }));
    });

    expect(screen.queryByTestId('guided-tour')).toBeNull();
    expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBe('true');
    expect(sessionStorage.getItem(TOUR_ONBOARDING_KEY)).toBeNull();
  });

  it('o X fecha o tour e persiste a decisão', () => {
    openTour();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Fechar tutorial/i }));
    });

    expect(screen.queryByTestId('guided-tour')).toBeNull();
    expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBe('true');
  });

  it('expõe um diálogo acessível com título associado', () => {
    openTour();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)).not.toBeNull();
  });

  it('bloqueia a rolagem do fundo e restaura exatamente o estilo anterior', () => {
    openTour();

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Pular/i }));
    });

    expect(document.body.style.overflow).toBe('auto');
    expect(document.documentElement.style.overflow).toBe('visible');
  });

  it('remove listeners de resize/scroll no cleanup', () => {
    const windowRemoveSpy = vi.spyOn(window, 'removeEventListener');
    openTour();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Pular/i }));
    });

    const viewportRemoved = viewportMock.removeEventListener.mock.calls.map((call) => call[0]);
    expect(viewportRemoved).toContain('resize');
    expect(viewportRemoved).toContain('scroll');

    const windowRemoved = windowRemoveSpy.mock.calls.map((call) => String(call[0]));
    expect(windowRemoved).toContain('resize');
    expect(windowRemoved).toContain('scroll');
  });

  it('não mostra tooltip em 0,0 quando o alvo não existe — avança com segurança', () => {
    document.getElementById('tour-nav-walk')?.remove();
    openTour();
    stepTo(1); // vai para a etapa 2, cujo alvo não existe

    // Após algumas tentativas o tour avança para a próxima etapa existente.
    act(() => {
      vi.advanceTimersByTime(64 * (MAX_TARGET_MISSES + 4));
    });

    expect(screen.getByTestId('guided-tour-tooltip')).toBeInTheDocument();
    expect(screen.getByTestId('guided-tour-tooltip').textContent).not.toBe('');
    expect(screen.getByTestId('guided-tour-tooltip').style.top).not.toBe('');
  });
});
