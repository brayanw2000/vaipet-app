import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

/**
 * Tela branca do mapa/passeio.
 *
 * O Mapbox GL lança no construtor quando não há token válido e pode nunca
 * carregar o estilo. Sem tratamento, a exceção sobe pela árvore React e a
 * rota `/search-walk` fica completamente branca.
 *
 * Aqui validamos que:
 *  - sem token o construtor do Mapbox NUNCA é chamado e existe fallback;
 *  - construtor lançando / evento de erro / timeout mostram o fallback;
 *  - com token, uma única instância é criada e o cleanup remove tudo.
 */

const tokenState = vi.hoisted(() => ({
  has: false,
  token: null as string | null,
}));

vi.mock('@/lib/mapboxConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mapboxConfig')>();
  return {
    ...actual,
    get hasMapboxToken() {
      return tokenState.has;
    },
    get mapboxToken() {
      return tokenState.token;
    },
  };
});

const mapboxState = vi.hoisted(() => ({
  shouldThrow: false,
  autoLoad: true,
  created: 0,
  instances: [] as Array<Record<string, unknown>>,
}));

vi.mock('mapbox-gl', () => {
  const Map = vi.fn(function MapMock(this: unknown) {
    mapboxState.created += 1;
    if (mapboxState.shouldThrow) throw new Error('token do Mapbox inválido');

    const handlers: Record<string, Array<(event?: unknown) => void>> = {};
    const instance: Record<string, unknown> = {
      handlers,
      on: vi.fn((event: string, cb: (event?: unknown) => void) => {
        (handlers[event] ||= []).push(cb);
        if (event === 'load' && mapboxState.autoLoad) cb();
        return instance;
      }),
      off: vi.fn(() => instance),
      remove: vi.fn(),
      setConfigProperty: vi.fn(),
      setPaintProperty: vi.fn(),
      setLayoutProperty: vi.fn(),
      setStyle: vi.fn(),
      getStyle: vi.fn(() => ({ layers: [] })),
      getLayer: vi.fn(() => undefined),
      getSource: vi.fn(() => undefined),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      flyTo: vi.fn(),
      easeTo: vi.fn(),
      jumpTo: vi.fn(),
      fitBounds: vi.fn(),
      resize: vi.fn(),
      isStyleLoaded: vi.fn(() => true),
      loaded: vi.fn(() => true),
      getZoom: vi.fn(() => 15),
      getCenter: vi.fn(() => ({ lng: -46.7, lat: -23.6 })),
      getBearing: vi.fn(() => 0),
      getPitch: vi.fn(() => 0),
      project: vi.fn(() => ({ x: 0, y: 0 })),
      unproject: vi.fn(() => ({ lng: 0, lat: 0 })),
      triggerRepaint: vi.fn(),
      getContainer: vi.fn(() => document.createElement('div')),
      emit: (event: string) => (handlers[event] || []).forEach((cb) => cb()),
    };
    mapboxState.instances.push(instance);
    return instance;
  });

  class Marker {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
    getElement() {
      return document.createElement('div');
    }
  }

  class Popup {
    setHTML() {
      return this;
    }
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }

  return {
    default: { Map, Marker, Popup, accessToken: '', LngLatBounds: class {} },
    Map,
    Marker,
    Popup,
  };
});

vi.mock('@/lib/mapStyle', () => ({
  hideMapLabels: vi.fn(),
  enrichMap: vi.fn(),
  tintMapInk: vi.fn(),
}));

vi.mock('@/lib/dog3dLayer', () => ({
  preloadDog3DAsset: vi.fn(() => Promise.resolve()),
  createDog3DLayer: vi.fn(),
}));

vi.mock('@/lib/checkpoint3dLayer', () => ({
  preloadCheckpointAsset: vi.fn(() => Promise.resolve()),
  createCheckpoint3DLayer: vi.fn(),
}));

vi.mock('../components/WalkInProgress', () => ({
  WalkInProgress: () => <div data-testid="walk-in-progress" />,
}));

vi.mock('../components/WaitingForAcceptance', () => ({
  WaitingForAcceptance: () => <div data-testid="waiting-for-acceptance" />,
}));

vi.mock('../components/ReviewWalk', () => ({ ReviewWalk: () => <div /> }));

vi.mock('../components/SlideToConfirm', () => ({
  SlideToConfirm: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button data-testid="slide-to-confirm" disabled={disabled}>
      {label}
    </button>
  ),
}));

const authUser = { id: 'user-test-1', user_metadata: {} };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser, session: {}, profile: null, loading: false }),
}));

const makeChain = () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  ['select', 'eq', 'in', 'order', 'limit', 'update', 'delete', 'gte', 'lte', 'neq', 'is', 'insert'].forEach(
    (key) => {
      chain[key] = vi.fn(self);
    },
  );
  chain.single = vi.fn(async () => ({ data: { id: 'session-test-1' }, error: null }));
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: [{ id: 'pet-1', name: 'Rex' }], error: null }).then(resolve);
  return chain;
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => makeChain()),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import SearchWalk, { MAP_LOAD_TIMEOUT_MS } from './SearchWalk';
import { MapboxGuard } from '@/components/MapboxGuard';

const setToken = (has: boolean) => {
  tokenState.has = has;
  tokenState.token = has ? 'pk.test-token' : null;
};

const renderRoute = () =>
  render(
    <MemoryRouter initialEntries={['/search-walk']}>
      <MapboxGuard>
        <SearchWalk />
      </MapboxGuard>
    </MemoryRouter>,
  );

const renderBare = () =>
  render(
    <MemoryRouter initialEntries={['/search-walk']}>
      <SearchWalk />
    </MemoryRouter>,
  );

describe('Mapbox na rota /search-walk', () => {
  beforeEach(() => {
    mapboxState.shouldThrow = false;
    mapboxState.autoLoad = true;
    mapboxState.created = 0;
    mapboxState.instances = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  describe('sem VITE_MAPBOX_TOKEN', () => {
    beforeEach(() => setToken(false));

    it('nunca chama o construtor do Mapbox e mostra o fallback (rota não fica branca)', async () => {
      renderRoute();

      expect(await screen.findByTestId('map-unavailable-fallback')).toBeInTheDocument();
      expect(screen.getByText('Mapa indisponível no momento')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Voltar para a Home/i })).toBeInTheDocument();
      expect(mapboxState.created).toBe(0);
    });

    it('a tela isolada também não instancia o mapa e renderiza conteúdo', async () => {
      renderBare();

      // O wizard da tela continua montado (nada de rota em branco).
      expect(await screen.findByText('Rex')).toBeInTheDocument();
      expect(mapboxState.created).toBe(0);
    });
  });

  describe('com token válido', () => {
    beforeEach(() => setToken(true));

    it('cria uma única instância quando o mapa carrega e limpa tudo no unmount', async () => {
      const { unmount } = renderRoute();

      await waitFor(() => expect(mapboxState.created).toBe(1));
      expect(screen.queryByTestId('map-unavailable-fallback')).toBeNull();

      const instance = mapboxState.instances[0];
      unmount();

      expect(instance.off).toHaveBeenCalledWith('load', expect.any(Function));
      expect(instance.off).toHaveBeenCalledWith('error', expect.any(Function));
      expect(instance.remove).toHaveBeenCalledTimes(1);
    });

    it('construtor lançando erro mostra o fallback em vez de tela branca', async () => {
      mapboxState.shouldThrow = true;
      renderRoute();

      expect(await screen.findByTestId('map-unavailable-fallback')).toBeInTheDocument();
      expect(mapboxState.created).toBe(1);
    });

    it('evento de erro do Mapbox antes do load mostra o fallback', async () => {
      mapboxState.autoLoad = false;
      renderRoute();

      await waitFor(() => expect(mapboxState.created).toBe(1));
      const instance = mapboxState.instances[0];

      act(() => {
        (instance.emit as (event: string) => void)('error');
      });

      expect(await screen.findByTestId('map-unavailable-fallback')).toBeInTheDocument();
    });

    it('timeout de carregamento mostra o fallback', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mapboxState.autoLoad = false;
      renderRoute();

      await waitFor(() => expect(mapboxState.created).toBe(1));

      await act(async () => {
        vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS + 250);
      });

      await waitFor(() =>
        expect(screen.queryByTestId('map-unavailable-fallback')).not.toBeNull(),
      );
    });

    it('"Tentar novamente" remonta a tela e tenta o mapa outra vez', async () => {
      mapboxState.shouldThrow = true;
      renderRoute();

      const retry = await screen.findByRole('button', { name: /Tentar novamente/i });
      expect(mapboxState.created).toBe(1);

      mapboxState.shouldThrow = false;
      act(() => {
        retry.click();
      });

      await waitFor(() => expect(mapboxState.created).toBe(2));
    });
  });
});
