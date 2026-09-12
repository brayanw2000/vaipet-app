import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Localização na Home nunca bloqueia o usuário.
 *
 * Regressão 1: requestLocation() rodava no mount e, com a permissão negada,
 * abria o modal automaticamente; o "Tentar novamente" recarregava a página
 * (window.location.reload()) e não havia como continuar sem ativar.
 *
 * Regressão 2 (iPhone): permissions.query(denied) ou a ausência/rejeição da
 * Permissions API impediam o getCurrentPosition iniciado pelo usuário — no
 * Safari/WebKit o pedido de permissão nunca aparecia. Agora o getCurrentPosition
 * é chamado DIRETAMENTE no evento do usuário, erros são tratados por código
 * (1 negado / 2 indisponível / 3 timeout) e callbacks antigos após unmount
 * são descartados. Coordenadas reais do dispositivo, nunca um fallback.
 */

// Framer Motion no jsdom: repassa o conteúdo para tags reais.
vi.mock('framer-motion', () => {
  const strip = ({
    children: _children,
    variants: _variants,
    initial: _initial,
    animate: _animate,
    exit: _exit,
    transition: _transition,
    ...rest
  }: Record<string, unknown>) => rest;
  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => (props: Record<string, unknown>) =>
          React.createElement(tag, strip(props), props.children as React.ReactNode),
      },
    ),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

// Referência estável — objeto novo a cada render re-dispararia o efeito de
// carregamento (que depende de `user`) em loop.
const authUser = { id: 'user-1' };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser, profile: null, loading: false }),
}));

// Home lê pets, passeios concluídos, localização padrão e perfil.
// locations vem vazio: a localização é responsabilidade do fluxo em teste.
const tableData: Record<string, unknown> = {
  pets: [{ id: 'pet-1', name: 'Rex', breed: null, avatar_url: null }],
  walk_sessions: [],
  profiles: { avatar_url: null },
  locations: null,
};

const makeChain = (table: string) => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  ['select', 'eq', 'order', 'limit'].forEach((key) => {
    chain[key] = vi.fn(self);
  });
  chain.maybeSingle = vi.fn(async () => ({ data: tableData[table] ?? null, error: null }));
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({
      data: Array.isArray(tableData[table]) ? tableData[table] : [],
      error: null,
    }).then(resolve);
  return chain;
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => makeChain(table)),
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
  },
}));

import { HomePasseio } from './HomePasseio';

// ---------- geolocation double ----------

type PosHandler = (pos: GeolocationPosition) => void;
type ErrHandler = (err: GeolocationPositionError) => void;

const geoState = {
  succeed: true,
  calls: 0,
  resolvers: [] as Array<{ resolve: PosHandler; reject: ErrHandler }>,
};

const installGeolocation = () => {
  // O setup global define navigator.geolocation como writable (não
  // configurable), então substituímos por atribuição em vez de defineProperty.
  (navigator as unknown as { geolocation: Geolocation }).geolocation = {
    getCurrentPosition: vi.fn((resolve: PosHandler, reject: ErrHandler) => {
      geoState.calls += 1;
      geoState.resolvers.push({ resolve, reject });
      return undefined;
    }),
    watchPosition: vi.fn(() => 1),
    clearWatch: vi.fn(),
  } as unknown as Geolocation;
};

const geoCoords = { latitude: -23.6001, longitude: -46.7001, accuracy: 10 };

const resolveAll = (coords: { latitude: number; longitude: number; accuracy: number } = geoCoords) => {
  const pending = [...geoState.resolvers];
  geoState.resolvers = [];
  pending.forEach(({ resolve }) =>
    resolve({
      coords,
    } as GeolocationPosition),
  );
};

const rejectAll = (code: number) => {
  const pending = [...geoState.resolvers];
  geoState.resolvers = [];
  pending.forEach(({ reject }) =>
    reject({
      code,
      message:
        code === 1
          ? 'User denied Geolocation'
          : code === 3
            ? 'Position acquisition timed out'
            : 'Position unavailable',
    } as GeolocationPositionError),
  );
};

// ---------- permissions double ----------

type PermListener = (state: string) => void;

const installPermissions = (initial: string | null) => {
  if (initial === null) {
    // Permissions API ausente.
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    return { setStatus: () => {} };
  }

  let status = initial;
  const listeners: PermListener[] = [];
  const permission = {
    state: status,
    onchange: null as PermListener | null,
    addEventListener: (_t: string, cb: PermListener) => listeners.push(cb),
    removeEventListener: () => {},
  };
  const query = vi.fn(async () => {
    permission.state = status;
    return permission;
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    writable: true,
    value: { query },
  });
  return {
    query,
    setStatus: (next: string) => {
      status = next;
      permission.state = next;
      listeners.forEach((cb) => cb(next));
      permission.onchange?.(next);
    },
  };
};

const reloadSpy = () => {
  const reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, reload },
  });
  return reload;
};

const renderHome = () =>
  render(
    <MemoryRouter>
      <HomePasseio />
    </MemoryRouter>,
  );

const findCardButton = async () => {
  // O botão do card só existe quando não há localização resolvida.
  return await screen.findByRole('button', { name: /Ativar localização|Como ativar localização|Buscando…/ });
};

const openModalByExplicitDenial = async () => {
  // Usuário clica no botão do card (ação explícita) e a solicitação é negada.
  const button = await findCardButton();
  act(() => {
    fireEvent.click(button);
  });
  expect(geoState.calls).toBe(1);
  act(() => {
    rejectAll(1);
  });
  expect(await screen.findByTestId('location-blocked-modal')).toBeInTheDocument();
};

describe('Home — localização sem bloquear o usuário', () => {
  let permissions: ReturnType<typeof installPermissions>;

  beforeEach(() => {
    geoState.succeed = true;
    geoState.calls = 0;
    geoState.resolvers = [];
    installGeolocation();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    vi.restoreAllMocks();
  });

  describe('mount', () => {
    it('permissão denied no mount NÃO abre o modal e não solicita localização', async () => {
      permissions = installPermissions('denied');
      renderHome();

      // A Home renderiza normalmente...
      expect(await screen.findByText('Explorar')).toBeInTheDocument();
      // ...sem modal e sem chamada de geolocalização.
      expect(screen.queryByTestId('location-blocked-modal')).toBeNull();
      expect(geoState.calls).toBe(0);

      // O estado "denied" reflete no botão do card, que abre o modal só se clicado.
      expect(await findCardButton()).toHaveTextContent('Como ativar localização');
      expect(screen.queryByTestId('location-blocked-modal')).toBeNull();
    });

    it('permissão prompt no mount NÃO chama getCurrentPosition', async () => {
      permissions = installPermissions('prompt');
      renderHome();

      expect(await screen.findByText('Explorar')).toBeInTheDocument();
      // Deixa os microtasks assentarem.
      await act(async () => {});
      expect(geoState.calls).toBe(0);
      expect(screen.queryByTestId('location-blocked-modal')).toBeNull();
    });

    it('Permissions API ausente não quebra e não solicita localização', async () => {
      permissions = installPermissions(null);
      renderHome();

      expect(await screen.findByText('Explorar')).toBeInTheDocument();
      await act(async () => {});
      expect(geoState.calls).toBe(0);
      expect(screen.queryByTestId('location-blocked-modal')).toBeNull();
    });

    it('permissão granted obtém a localização silenciosamente', async () => {
      permissions = installPermissions('granted');
      renderHome();

      await waitFor(() => expect(geoState.calls).toBe(1));
      act(() => {
        resolveAll();
      });

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /Ativar localização/ })).toBeNull();
      });
      // Nem erro silencioso abre modal — e aqui deu sucesso.
      expect(screen.queryByTestId('location-blocked-modal')).toBeNull();
    });

    it('permissão granted com falha silenciosa NÃO abre o modal', async () => {
      permissions = installPermissions('granted');
      renderHome();

      await waitFor(() => expect(geoState.calls).toBe(1));
      act(() => {
        rejectAll(2);
      });

      expect(await screen.findByText('Explorar')).toBeInTheDocument();
      expect(screen.queryByTestId('location-blocked-modal')).toBeNull();
    });
  });

  describe('solicitação explícita', () => {
    beforeEach(() => {
      permissions = installPermissions('prompt');
    });

    it('ação explícita negada abre o modal e mantém a Home funcionando', async () => {
      renderHome();
      await openModalByExplicitDenial();

      // O título do modal (heading) distingue do rótulo do card.
      expect(screen.getByRole('heading', { name: 'Localização desativada' })).toBeInTheDocument();
      // Home continua montada por baixo do modal.
      expect(screen.getByText('Explorar')).toBeInTheDocument();
    });

    it('"Tentar novamente" chama getCurrentPosition e nunca faz reload', async () => {
      const reload = reloadSpy();
      renderHome();
      await openModalByExplicitDenial();

      const retry = screen.getByRole('button', { name: /Tentar novamente/i });
      const callsBefore = geoState.calls;
      act(() => {
        fireEvent.click(retry);
      });
      expect(geoState.calls).toBe(callsBefore + 1);
      expect(reload).not.toHaveBeenCalled();

      // Sucesso fecha o modal, atualiza a localização e limpa o estado negado.
      act(() => {
        resolveAll();
      });
      await waitFor(() =>
        expect(screen.queryByTestId('location-blocked-modal')).toBeNull(),
      );
      expect(reload).not.toHaveBeenCalled();
    });

    it('cliques repetidos em "Tentar novamente" não criam solicitações paralelas', async () => {
      renderHome();
      await openModalByExplicitDenial();

      const retry = screen.getByRole('button', { name: /Tentar novamente/i });
      const callsBefore = geoState.calls;
      act(() => {
        fireEvent.click(retry);
        fireEvent.click(retry);
        fireEvent.click(retry);
      });
      // Apenas uma nova chamada, apesar dos três cliques.
      expect(geoState.calls).toBe(callsBefore + 1);

      act(() => {
        resolveAll();
      });
      await waitFor(() =>
        expect(screen.queryByTestId('location-blocked-modal')).toBeNull(),
      );
    });

    it('backdrop fecha o modal', async () => {
      renderHome();
      await openModalByExplicitDenial();

      act(() => {
        fireEvent.click(screen.getByTestId('location-modal-backdrop'));
      });
      expect(screen.queryByTestId('location-blocked-modal')).toBeNull();
    });

    it('botão X fecha o modal', async () => {
      renderHome();
      await openModalByExplicitDenial();

      act(() => {
        fireEvent.click(screen.getByTestId('location-modal-close'));
      });
      expect(screen.queryByTestId('location-blocked-modal')).toBeNull();
    });

    it('"Ativar depois" fecha o modal', async () => {
      renderHome();
      await openModalByExplicitDenial();

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Ativar depois/i }));
      });
      expect(screen.queryByTestId('location-blocked-modal')).toBeNull();
    });

    it('clique dentro do card não fecha o modal', async () => {
      renderHome();
      await openModalByExplicitDenial();

      // Clica no título do card (dentro do dialog, sem fechar).
      act(() => {
        fireEvent.click(screen.getByRole('heading', { name: 'Localização desativada' }));
      });
      expect(screen.getByTestId('location-blocked-modal')).toBeInTheDocument();
    });

    it('tecla Escape fecha o modal', async () => {
      renderHome();
      await openModalByExplicitDenial();

      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      expect(screen.queryByTestId('location-blocked-modal')).toBeNull();
    });

    it('modal é acessível: dialog com aria-modal e título associado', async () => {
      renderHome();
      await openModalByExplicitDenial();

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      expect(document.getElementById(labelledBy as string)).not.toBeNull();
    });

    it('botão do card com estado negado ainda TENTA de novo e abre o modal só se o navegador negar', async () => {
      permissions = installPermissions('denied');
      renderHome();

      expect(await screen.findByText('Explorar')).toBeInTheDocument();
      const button = await findCardButton();
      expect(button).toHaveTextContent('Como ativar localização');

      // O clique é SEMPRE uma tentativa real — permissions é só informativo.
      act(() => {
        fireEvent.click(button);
      });
      expect(geoState.calls).toBe(1);

      // Navegador nega de novo (código 1) → modal com instruções reais.
      act(() => {
        rejectAll(1);
      });
      expect(screen.getByTestId('location-blocked-modal')).toBeInTheDocument();
    });
  });

  describe('geolocalização real no iPhone — chamada direta no evento', () => {
    it('permissions.query retorna denied, mas o clique explícito ainda chama getCurrentPosition uma vez', async () => {
      permissions = installPermissions('denied');
      renderHome();

      // Mount denied: só marca o estado, sem modal, sem chamada.
      expect(await screen.findByText('Explorar')).toBeInTheDocument();
      expect(geoState.calls).toBe(0);

      const button = await findCardButton();
      expect(button).toHaveTextContent('Como ativar localização');

      // Clique explícito MESMO com permissions denied: a chamada acontece.
      act(() => {
        fireEvent.click(button);
      });
      expect(geoState.calls).toBe(1);

      // O navegador decide agora — se o usuário permitir, o fix real é aceito.
      act(() => {
        resolveAll({ latitude: -23.61, longitude: -46.71, accuracy: 12 });
      });
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /Ativar localização/ })).toBeNull(),
      );
    });

    it('Permissions API ausente não impede a solicitação explícita', async () => {
      permissions = installPermissions(null);
      renderHome();

      expect(await screen.findByText('Explorar')).toBeInTheDocument();
      const button = await findCardButton();
      act(() => {
        fireEvent.click(button);
      });
      expect(geoState.calls).toBe(1);
    });

    it('permissions.query rejeitando não impede a solicitação explícita', async () => {
      // query() que rejeita (comportamento visto no Safari/WebKit).
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        writable: true,
        value: {
          query: vi.fn(async () => {
            throw new Error('NotAllowedError');
          }),
        },
      });
      renderHome();

      expect(await screen.findByText('Explorar')).toBeInTheDocument();
      const button = await findCardButton();
      act(() => {
        fireEvent.click(button);
      });
      expect(geoState.calls).toBe(1);
    });

    it('sucesso atualiza latitude/longitude EXATAS do dispositivo', async () => {
      permissions = installPermissions('prompt');
      renderHome();

      const exact = { latitude: -23.589417, longitude: -46.657941, accuracy: 8 };
      const button = await findCardButton();
      act(() => {
        fireEvent.click(button);
      });
      act(() => {
        resolveAll(exact);
      });

      // "Localização desativada" some e o card continua funcionando.
      await waitFor(() =>
        expect(screen.queryByText('Localização desativada')).toBeNull(),
      );
      expect(screen.getByText('Explorar')).toBeInTheDocument();

      // O clima é buscado com as coordenadas exatas (Open-Meteo).
      const fetchMock = vi.mocked(fetch);
      const weatherUrl = fetchMock.mock.calls
        .map((c) => String((c as unknown[])[0]))
        .find((u) => u.includes('api.open-meteo.com'));
      expect(weatherUrl).toContain(`latitude=${exact.latitude}`);
      expect(weatherUrl).toContain(`longitude=${exact.longitude}`);
    });

    it('timeout (código 3) não marca como negado e mantém a Home utilizável', async () => {
      permissions = installPermissions('prompt');
      renderHome();

      const button = await findCardButton();
      act(() => {
        fireEvent.click(button);
      });
      act(() => {
        rejectAll(3);
      });

      // O modal de permissão NÃO abre (não é problema de permissão), o estado
      // NÃO vira "negado" e o botão do card permite nova tentativa imediata.
      await waitFor(() => expect(screen.getByText('Explorar')).toBeInTheDocument());
      const cardButton = await findCardButton();
      expect(cardButton).toHaveTextContent('Ativar localização');
      expect(cardButton).not.toBeDisabled();
      expect(screen.queryByTestId('location-blocked-modal')).toBeNull();
    });

    it('indisponibilidade (código 2) mantém a Home utilizável', async () => {
      permissions = installPermissions('prompt');
      renderHome();

      const button = await findCardButton();
      act(() => {
        fireEvent.click(button);
      });
      act(() => {
        rejectAll(2);
      });

      // Sem posição e SEM modal de permissão (não é problema de permissão);
      // a Home segue utilizável e nova tentativa é imediata.
      expect(await screen.findByText('Explorar')).toBeInTheDocument();
      expect(screen.queryByTestId('location-blocked-modal')).toBeNull();
      const cardButton = await findCardButton();
      expect(cardButton).toHaveTextContent('Ativar localização');
    });

    it('callback antigo após unmount não atualiza estado', async () => {
      permissions = installPermissions('prompt');
      const { unmount } = renderHome();

      const button = await findCardButton();
      act(() => {
        fireEvent.click(button);
      });
      expect(geoState.calls).toBe(1);
      expect(geoState.resolvers).toHaveLength(1);

      // Unmount ANTES da resposta do GPS.
      unmount();
      cleanup();

      // Resposta chega depois: nada pode atualizar estado nem lançar erro.
      expect(() =>
        act(() => {
          resolveAll({ latitude: -10, longitude: -10, accuracy: 5 });
        }),
      ).not.toThrow();
    });

    it('nenhum fallback é apresentado como localização atual (erros não criam posição)', async () => {
      permissions = installPermissions('prompt');
      renderHome();

      const button = await findCardButton();
      act(() => {
        fireEvent.click(button);
      });
      act(() => {
        rejectAll(1);
      });

      // Com erro, NENHUMA posição (nem padrão) vira "localização atual": o
      // card de ativação permanece e o modal informativo explica o porquê.
      expect(await findCardButton()).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Localização desativada' }),
      ).toBeInTheDocument();
    });

    it('opções usadas: enableHighAccuracy, timeout 15s e maximumAge 0 (fix real)', async () => {
      permissions = installPermissions('prompt');
      renderHome();

      const button = await findCardButton();
      act(() => {
        fireEvent.click(button);
      });

      const geo = navigator.geolocation as unknown as {
        getCurrentPosition: ReturnType<typeof vi.fn>;
      };
      const options = geo.getCurrentPosition.mock.calls[0]?.[2] as
        | PositionOptions
        | undefined;
      expect(options).toMatchObject({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });
  });
});
