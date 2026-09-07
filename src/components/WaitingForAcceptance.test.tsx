import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { WaitingForAcceptance } from "./WaitingForAcceptance";

// Mapbox is instantiated on mount and needs WebGL — stub it out entirely.
vi.mock("mapbox-gl", () => {
  class Map {
    on(evt: string, cb: () => void) {
      if (evt === "load") cb();
      return this;
    }
    remove() {}
    getStyle() {
      return { layers: [] };
    }
    setConfigProperty() {}
    setPaintProperty() {}
    setLayoutProperty() {}
  }
  return { default: { Map, accessToken: "" }, Map };
});

vi.mock("@/lib/mapStyle", () => ({
  hideMapLabels: vi.fn(),
  enrichMap: vi.fn(),
  tintMapInk: vi.fn(),
}));

const renderWaiting = (props: Partial<Parameters<typeof WaitingForAcceptance>[0]> = {}) => {
  const onTimeout = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <WaitingForAcceptance
      onTimeout={onTimeout}
      onCancel={onCancel}
      userLocation={[-46.6333, -23.5505]}
      {...props}
    />,
  );
  return { onTimeout, onCancel, ...utils };
};

describe("WaitingForAcceptance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("mostra o estado Aguardando e o contador", () => {
    renderWaiting();
    expect(screen.getByText("Aguardando")).toBeInTheDocument();
    expect(screen.getByText(/Buscando... • 5:00/)).toBeInTheDocument();
  });

  it("não dispara onTimeout antes do tempo previsto", () => {
    const { onTimeout } = renderWaiting();
    act(() => {
      vi.advanceTimersByTime(299_000);
    });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("dispara onTimeout ao esgotar o tempo", () => {
    const { onTimeout } = renderWaiting();
    act(() => {
      vi.advanceTimersByTime(301_000);
    });
    expect(onTimeout).toHaveBeenCalled();
  });

  it("limpa os timers no unmount, sem callbacks fantasmas", () => {
    const { onTimeout, unmount } = renderWaiting();
    unmount();
    act(() => {
      vi.advanceTimersByTime(600_000);
    });
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
