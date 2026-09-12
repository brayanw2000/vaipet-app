import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Localização na Home nunca bloqueia o usuário.
 *
 * Regressão: requestLocation() rodava no mount e, com a permissão negada,
 * abria o modal automaticamente; o "Tentar novamente" recarregava a página
 * (window.location.reload()) e não havia como continuar sem ativar.
 *
 * Agora: no mount apenas consultamos a Permissions API (granted busca em
 * silêncio; denied só marca o estado); a solicitação só acontece por ação
 * explícita; o modal é informativo, fechável e sem reload.
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

const resolveAll = () => {
  const pending = [...geoState.resolvers];
  geoState.resolvers = [];
  pending.forEach(({ resolve }) =>
    resolve({
      coords: { latitude: -23.6001, longitude: -46.7001, accuracy: 10 },
    } as GeolocationPosition),
  );
};

const rejectAll = (code: number) => {
  const pending = [...geoState.resolvers];
  geoState.resolvers = [];
  pending.forEach(({ reject }) =>
    reject({
      code,
      message: code === 1 ? 'User denied Geolocation' : 'Position unavailable',
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

    it('botão do card diz "Como ativar localização" quando negado e abre o modal', async () => {
      renderHome();
      await openModalByExplicitDenial();

      // Fecha e volta ao card: estado negado persiste em memória.
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Ativar depois/i }));
      });
      const button = await findCardButton();
      expect(button).toHaveTextContent('Como ativar localização');

      act(() => {
        fireEvent.click(button);
      });
      expect(screen.getByTestId('location-blocked-modal')).toBeInTheDocument();
    });
  });
});
