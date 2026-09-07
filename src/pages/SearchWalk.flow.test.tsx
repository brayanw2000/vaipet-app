import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";

/**
 * Regression suite for the Search-Walk acceptance handoff.
 *
 * The bug this guards: after the petwalker accepted, the screen flashed into
 * the walk and bounced back to "Aguardando" (the recovery watchdog fired on
 * the happy path). These tests drive the real state machine of SearchWalk
 * with every heavy dependency (Mapbox, three.js, backend) stubbed out.
 */

// ---------- heavy dependency stubs ----------
vi.mock("mapbox-gl", () => {
  class Map {
    on(evt: string, cb: () => void) {
      if (evt === "load" || evt === "style.load") cb();
      return this;
    }
    once() {
      return this;
    }
    off() {
      return this;
    }
    remove() {}
    addLayer() {}
    removeLayer() {}
    addSource() {}
    removeSource() {}
    getLayer() {
      return undefined;
    }
    getSource() {
      return undefined;
    }
    getStyle() {
      return { layers: [] };
    }
    setStyle() {}
    setConfigProperty() {}
    setPaintProperty() {}
    setLayoutProperty() {}
    setFog() {}
    setTerrain() {}
    flyTo() {}
    easeTo() {}
    jumpTo() {}
    fitBounds() {}
    resize() {}
    triggerRepaint() {}
    isStyleLoaded() {
      return true;
    }
    getZoom() {
      return 15;
    }
    getCenter() {
      return { lng: -46.6333, lat: -23.5505 };
    }
    getBearing() {
      return 0;
    }
    getPitch() {
      return 0;
    }
    project() {
      return { x: 0, y: 0 };
    }
  }
  class Marker {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      return this;
    }
    getElement() {
      return document.createElement("div");
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
    remove() {
      return this;
    }
  }
  return { default: { Map, Marker, Popup, accessToken: "" }, Map, Marker, Popup };
});

vi.mock("@/lib/mapStyle", () => ({
  hideMapLabels: vi.fn(),
  enrichMap: vi.fn(),
  tintMapInk: vi.fn(),
}));

vi.mock("@/lib/dog3dLayer", () => ({
  preloadDog3DAsset: vi.fn(() => Promise.resolve()),
  createDog3DLayer: vi.fn(),
}));

vi.mock("@/lib/checkpoint3dLayer", () => ({
  preloadCheckpointAsset: vi.fn(() => Promise.resolve()),
  createCheckpoint3DLayer: vi.fn(),
}));

// Lightweight doubles that expose the transitions as plain buttons/labels.
vi.mock("@/components/WalkInProgress", () => ({
  WalkInProgress: () => <div data-testid="walk-in-progress">Passeio em andamento</div>,
}));
vi.mock("../components/WalkInProgress", () => ({
  WalkInProgress: () => <div data-testid="walk-in-progress">Passeio em andamento</div>,
}));

vi.mock("../components/WaitingForAcceptance", () => ({
  WaitingForAcceptance: ({ onAccepted }: { onAccepted: () => void }) => (
    <div data-testid="waiting-for-acceptance">
      <span>Aguardando</span>
      <button onClick={() => onAccepted()}>aceitar-teste</button>
    </div>
  ),
}));

vi.mock("../components/SlideToConfirm", () => ({
  SlideToConfirm: ({ onConfirm, disabled }: { onConfirm: () => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={() => onConfirm()}>
      confirmar-teste
    </button>
  ),
}));

vi.mock("../components/ReviewWalk", () => ({ ReviewWalk: () => <div /> }));

const authUser = { id: "user-test-1", email: "tester@example.com" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: authUser, session: {}, profile: {}, loading: false }),
}));

// ---------- backend double ----------
const insertOutcome: { fails: boolean; delayMs: number } = { fails: false, delayMs: 0 };

const makeChain = () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  ["select", "eq", "in", "order", "limit", "update", "delete", "gte", "lte", "neq", "is", "insert"].forEach(
    (k) => {
      chain[k] = vi.fn(self);
    },
  );
  chain.single = vi.fn(
    () =>
      new Promise((resolve) => {
        const settle = () =>
          resolve(
            insertOutcome.fails
              ? { data: null, error: new Error("insert failed") }
              : { data: { id: "session-test-1" }, error: null },
          );
        if (insertOutcome.delayMs > 0) setTimeout(settle, insertOutcome.delayMs);
        else settle();
      }),
  );
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [{ id: "pet-1", name: "Rex" }], error: null }).then(resolve);
  return chain;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => makeChain()),
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

import SearchWalk from "./SearchWalk";

const renderSearchWalk = () =>
  render(
    <MemoryRouter initialEntries={["/search-walk"]}>
      <SearchWalk />
    </MemoryRouter>,
  );

/** Drives the wizard up to the "Aguardando" (waiting for acceptance) phase. */
const goToWaiting = async () => {
  const utils = renderSearchWalk();
  // The pet list resolves asynchronously and auto-selects the single pet.
  await screen.findByText("Rex");
  for (let step = 0; step < 3; step++) {
    fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
  }
  // Slide-to-confirm kicks off the search: ~3s to "found", +4.2s to "waiting".
  fireEvent.click(await screen.findByRole("button", { name: "confirmar-teste" }));
  await act(async () => {
    vi.advanceTimersByTime(8000);
  });
  await screen.findByTestId("waiting-for-acceptance");
  return utils;
};

describe("Search-Walk — ciclo aguardando → aceito → passeio", () => {
  beforeEach(() => {
    insertOutcome.fails = false;
    insertOutcome.delayMs = 0;
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("chega na etapa (aguardando) depois de confirmar a busca", async () => {
    await goToWaiting();
    expect(screen.getByText("Aguardando")).toBeInTheDocument();
  });

  it("quando o petwalker aceita, entra no passeio e NÃO volta para (aguardando)", async () => {
    await goToWaiting();

    fireEvent.click(screen.getByRole("button", { name: "aceitar-teste" }));

    await screen.findByTestId("walk-in-progress");
    expect(screen.queryByTestId("waiting-for-acceptance")).not.toBeInTheDocument();

    // The 8s recovery watchdog must stay disarmed on the happy path — this is
    // exactly the regression that made the screen flash back to "Aguardando".
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });

    expect(screen.getByTestId("walk-in-progress")).toBeInTheDocument();
    expect(screen.queryByTestId("waiting-for-acceptance")).not.toBeInTheDocument();
  });

  it("aceitar duas vezes não reinicia o ciclo (proteção contra corrida)", async () => {
    await goToWaiting();

    const accept = screen.getByRole("button", { name: "aceitar-teste" });
    fireEvent.click(accept);
    fireEvent.click(accept);

    await screen.findByTestId("walk-in-progress");
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });

    expect(screen.getByTestId("walk-in-progress")).toBeInTheDocument();
    expect(screen.queryByTestId("waiting-for-acceptance")).not.toBeInTheDocument();
  });

  it("se a criação da sessão falhar, volta para (aguardando) em vez de travar", async () => {
    insertOutcome.fails = true;
    await goToWaiting();

    fireEvent.click(screen.getByRole("button", { name: "aceitar-teste" }));

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() =>
      expect(screen.getByTestId("waiting-for-acceptance")).toBeInTheDocument(),
    );
  });

  it("recupera para (aguardando) se a sessão nunca for confirmada (watchdog de 8s)", async () => {
    insertOutcome.delayMs = 60000; // session never lands in time
    await goToWaiting();

    fireEvent.click(screen.getByRole("button", { name: "aceitar-teste" }));
    await screen.findByTestId("walk-in-progress");

    await act(async () => {
      vi.advanceTimersByTime(9000);
    });

    await waitFor(() =>
      expect(screen.getByTestId("waiting-for-acceptance")).toBeInTheDocument(),
    );
  });
});

