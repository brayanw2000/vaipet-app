import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom has no geolocation — Search-Walk reads it on mount.
Object.defineProperty(window.navigator, "geolocation", {
  writable: true,
  value: {
    getCurrentPosition: (cb: PositionCallback) =>
      cb({
        coords: { longitude: -46.6333, latitude: -23.5505, accuracy: 10 },
      } as GeolocationPosition),
    watchPosition: () => 1,
    clearWatch: () => {},
  },
});

// Mapbox/Three touch these APIs during mount.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (!window.URL.createObjectURL) {
  window.URL.createObjectURL = () => "blob:mock";
}
