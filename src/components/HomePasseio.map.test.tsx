import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * A Home usa uma imagem estática do Mapbox. Sem `VITE_MAPBOX_TOKEN` a URL
 * ficava com `access_token=undefined` — requisição inválida e card sem mapa.
 *
 * Este teste garante que, sem token, o card continua de pé (fallback),
 * com um aviso discreto, e que nenhuma URL do Mapbox é montada.
 */

// Framer Motion no jsdom: só repassa o conteúdo para tags reais.
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

// Referência estável — um objeto novo a cada render re-dispararia o efeito
// de carregamento (que depende de `user`) em loop.
const authUser = { id: 'user-1' };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser, profile: null, loading: false }),
}));

// Home lê pets, passeios concluídos, localização padrão e perfil.
const tableData: Record<string, unknown> = {
  pets: [{ id: 'pet-1', name: 'Rex', breed: null, avatar_url: null }],
  walk_sessions: [],
  profiles: { avatar_url: null },
  locations: {
    name: 'Casa',
    address: 'Rua Teste, 100',
    city: 'São Paulo',
    latitude: -23.6001,
    longitude: -46.7001,
    is_default: true,
  },
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

const fetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({}),
}));

const fetchUrls = () =>
  fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));

describe('Home sem VITE_MAPBOX_TOKEN — nunca quebra e nunca usa token undefined', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('renderiza o card com fallback e aviso, sem imagem estática do Mapbox', async () => {
    render(
      <MemoryRouter>
        <HomePasseio />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.queryByText('Mapa temporariamente indisponível')).not.toBeNull(),
    );
    expect(document.querySelector('img[alt="Seu bairro"]')).toBeNull();
    // O card principal continua montado e acessível.
    expect(document.querySelector('#tour-start-walk')).not.toBeNull();
    expect(screen.queryByText('Buscar passeio')).not.toBeNull();
  });

  it('não produz nenhuma URL do Mapbox nem access_token=undefined', async () => {
    render(
      <MemoryRouter>
        <HomePasseio />
      </MemoryRouter>,
    );

    await screen.findByText('Mapa temporariamente indisponível');
    // Dá tempo para os efeitos de geocoding/clima rodarem.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const urls = fetchUrls();
    usersCanOnlyCallNonMapbox(urls);
  });
});

/** Nenhuma URL pode apontar para o Mapbox nem conter token indefinido. */
const usersCanOnlyCallNonMapbox = (urls: string[]) => {
  const mapboxUrls = urls.filter((url) => url.includes('api.mapbox.com'));
  expect(mapboxUrls, `URLs do Mapbox montadas sem token: ${mapboxUrls.join(', ')}`).toHaveLength(0);
  const undefinedTokenUrls = urls.filter((url) => url.includes('undefined'));
  expect(undefinedTokenUrls, `URLs com valor indefinido: ${undefinedTokenUrls.join(', ')}`).toHaveLength(0);
};
