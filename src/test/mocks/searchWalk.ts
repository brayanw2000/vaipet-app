import { vi } from "vitest";

/**
 * Shared mocks for Search-Walk tests.
 *
 * The screen mounts Mapbox GL (WebGL), preloads GLB assets through three.js
 * and talks to the backend. None of that is relevant to the state-machine
 * regressions we're guarding, so every dependency below is a no-op double.
 */

export const createMapMock = () => {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const map = {
    on: vi.fn((evt: string, cb: (...args: unknown[]) => void) => {
      (handlers[evt] ||= []).push(cb);
      if (evt === "load" || evt === "style.load") cb();
      return map;
    }),
    once: vi.fn((evt: string, cb: (...args: unknown[]) => void) => {
      (handlers[evt] ||= []).push(cb);
      return map;
    }),
    off: vi.fn(() => map),
    remove: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    addSource: vi.fn(),
    removeSource: vi.fn(),
    getLayer: vi.fn(() => undefined),
    getSource: vi.fn(() => undefined),
    getStyle: vi.fn(() => ({ layers: [] })),
    setStyle: vi.fn(),
    setConfigProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    setFog: vi.fn(),
    setTerrain: vi.fn(),
    setLight: vi.fn(),
    flyTo: vi.fn(),
    easeTo: vi.fn(),
    jumpTo: vi.fn(),
    fitBounds: vi.fn(),
    getZoom: vi.fn(() => 15),
    getCenter: vi.fn(() => ({ lng: -46.6333, lat: -23.5505 })),
    getBearing: vi.fn(() => 0),
    getPitch: vi.fn(() => 0),
    project: vi.fn(() => ({ x: 0, y: 0 })),
    unproject: vi.fn(() => ({ lng: 0, lat: 0 })),
    resize: vi.fn(),
    triggerRepaint: vi.fn(),
    isStyleLoaded: vi.fn(() => true),
    loaded: vi.fn(() => true),
    getContainer: vi.fn(() => document.createElement("div")),
    /** Test helper: fire a registered map event. */
    __emit: (evt: string) => (handlers[evt] || []).forEach((cb) => cb()),
  };
  return map;
};

export const createMarkerMock = () => {
  const marker = {
    setLngLat: vi.fn(() => marker),
    addTo: vi.fn(() => marker),
    remove: vi.fn(() => marker),
    setPopup: vi.fn(() => marker),
    getElement: vi.fn(() => document.createElement("div")),
    setRotation: vi.fn(() => marker),
  };
  return marker;
};

export const installMapboxMock = () => {
  vi.mock("mapbox-gl", () => {
    const Map = vi.fn(() => createMapMock());
    const Marker = vi.fn(() => createMarkerMock());
    const Popup = vi.fn(() => ({
      setHTML: vi.fn().mockReturnThis(),
      setLngLat: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
    }));
    return {
      default: { Map, Marker, Popup, accessToken: "", LngLatBounds: vi.fn() },
      Map,
      Marker,
      Popup,
    };
  });
};

/** Minimal chainable stand-in for the backend client used by Search-Walk. */
export const createBackendMock = (opts: { insertFails?: boolean } = {}) => {
  const insertResult = opts.insertFails
    ? { data: null, error: new Error("insert failed") }
    : { data: { id: "session-test-1" }, error: null };

  const builder = () => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    [
      "select",
      "eq",
      "in",
      "order",
      "limit",
      "update",
      "delete",
      "gte",
      "lte",
      "neq",
      "is",
    ].forEach((k) => {
      chain[k] = vi.fn(self);
    });
    chain.single = vi.fn(async () => insertResult);
    chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    chain.insert = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    return chain;
  };

  return {
    from: vi.fn(() => builder()),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  };
};
