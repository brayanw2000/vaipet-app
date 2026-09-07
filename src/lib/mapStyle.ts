import type mapboxgl from 'mapbox-gl';

/**
 * Hide every text label (street names, POI names, place names) on a Mapbox
 * map. Call this AFTER the style has loaded (e.g. inside `map.on('load')`)
 * and again on `styledata` so labels stay hidden after style swaps.
 */
export function hideMapLabels(map: mapboxgl.Map) {
  const apply = () => {
    for (const layer of map.getStyle().layers || []) {
      // Symbol layers are the ones that render text + icons. Hiding them
      // removes all street / place / POI names without affecting roads,
      // buildings, water, parks, etc.
      if (layer.type === 'symbol') {
        try { map.setLayoutProperty(layer.id, 'visibility', 'none'); } catch {}
      }
    }
  };
  apply();
  map.on('styledata', apply);
}

/**
 * Enrich a Mapbox map with a richer 3D look: terrain DEM, sky atmosphere,
 * soft fog, and 3D building extrusions. Safe to call multiple times and
 * after style swaps.
 */
export function enrichMap(map: mapboxgl.Map, isDay: boolean = true) {
  const apply = () => {
    try {
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        } as any);
      }
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.1 } as any);
    } catch {}

    try {
      map.setFog({
        range: [0.5, 10],
        color: isDay ? 'rgb(220, 230, 240)' : 'rgb(20, 25, 40)',
        'high-color': isDay ? 'rgb(180, 200, 230)' : 'rgb(40, 50, 80)',
        'horizon-blend': 0.1,
        'space-color': isDay ? 'rgb(150, 180, 220)' : 'rgb(11, 11, 25)',
        'star-intensity': isDay ? 0 : 0.6,
      } as any);
    } catch {}

    // Disable 3D structures and objects explicitly across Mapbox Standard
    // and legacy styles. Standard does not always expose a single
    // `3d-buildings` layer id, so flatten/hide every fill-extrusion layer.
    try {
      if (map.getLayer('3d-buildings')) map.removeLayer('3d-buildings');
      const layers = map.getStyle().layers || [];
      for (const layer of layers) {
        const id = layer.id.toLowerCase();
        // Hide buildings, trees, and any other 3D objects in Standard and legacy
        if (
          layer.type === 'fill-extrusion' || 
          id.includes('building') || 
          id.includes('tree') || 
          id.includes('3d') ||
          ((layer as any).source === 'composite' && (layer as any).sourceLayer === 'building')
        ) {
          try {
            if (layer.type === 'fill-extrusion') {
              map.setPaintProperty(layer.id, 'fill-extrusion-height', 0);
              map.setPaintProperty(layer.id, 'fill-extrusion-base', 0);
            }
            map.setLayoutProperty(layer.id, 'visibility', 'none');
          } catch {}
        }
      }
      map.setConfigProperty('basemap', 'show3dObjects', false);
    } catch {}
  };

  apply();
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(apply);
  setTimeout(apply, 120);
}

/**
 * Neutral tint applied on top of Mapbox styles so dark mode stays charcoal
 * with gray street details, and light mode stays visibly light. No brand-green
 * tint is used on map surfaces.
 *
 * Safe to call multiple times and after style swaps (re-bind on styledata).
 */
export function tintMapInk(map: mapboxgl.Map, isDark: boolean = true) {
  const PALETTE = isDark
    ? {
        BG: '#0B1410',
        LAND: '#0B1410',
        BUILD: '#16211C',
        BUILD_LINE: '#1E2D26',
        ROAD_MINOR: '#1E2D26',
        ROAD_MAIN: '#2A3F35',
        ROAD_HWY: '#31D880',
        WATER: '#060B08',
        PARK: '#0D1A14',
        PARK_LINE: '#1E2D26',
        ADMIN: '#31D880',
        FOG: '#0B1410',
        FOG_HIGH: '#16211C',
        STAR: 0.35,
      }

    : {
        // Paper / pastel editorial light palette
        BG: '#F2F1E8',
        LAND: '#F2F1E8',
        BUILD: '#E6E3D8',
        BUILD_LINE: '#D6CFB8',
        ROAD_MINOR: '#FFFFFF',
        ROAD_MAIN: '#FFFFFF',
        ROAD_HWY: '#EEE4C8',
        WATER: '#D5E8E5',
        PARK: '#C5DEBC',
        PARK_LINE: '#C5DEBC',
        ADMIN: '#46534D',
        FOG: '#F2F1E8',
        FOG_HIGH: '#E6E3D8',
        STAR: 0,
      };
  const P = PALETTE;

  const apply = () => {
    const layers = map.getStyle().layers || [];
    for (const layer of layers) {
      const id = layer.id.toLowerCase();
      try {
        if (layer.type === 'background') {
          map.setPaintProperty(layer.id, 'background-color', P.BG);
          continue;
        }
        if (layer.type === 'fill') {
          if (id.includes('water')) {
            map.setPaintProperty(layer.id, 'fill-color', P.WATER);
          } else if (id.includes('park') || id.includes('grass') || id.includes('wood') || id.includes('vegetation') || id.includes('green')) {
            map.setPaintProperty(layer.id, 'fill-color', P.PARK);
          } else if (id.includes('building')) {
            map.setPaintProperty(layer.id, 'fill-color', P.BUILD);
          } else if (id.includes('sand') || id.includes('beach')) {
            map.setPaintProperty(layer.id, 'fill-color', P.LAND);
          } else if (id.includes('land') || id.includes('landuse') || id.includes('national') || id.includes('pitch') || id.includes('aeroway')) {
            map.setPaintProperty(layer.id, 'fill-color', P.LAND);
          } else {
            map.setPaintProperty(layer.id, 'fill-color', P.LAND);
          }
          continue;
        }
        if (layer.type === 'line') {
          if (id.includes('water') || id.includes('river') || id.includes('canal') || id.includes('stream')) {
            map.setPaintProperty(layer.id, 'line-color', P.WATER);
          } else if (id.includes('park') || id.includes('green')) {
            map.setPaintProperty(layer.id, 'line-color', P.PARK_LINE);
          } else if (id.includes('motorway') || id.includes('trunk')) {
            map.setPaintProperty(layer.id, 'line-color', P.ROAD_HWY);
          } else if (id.includes('primary') || id.includes('secondary')) {
            map.setPaintProperty(layer.id, 'line-color', P.ROAD_MAIN);
          } else if (id.includes('road') || id.includes('street') || id.includes('path') || id.includes('tertiary') || id.includes('service') || id.includes('minor')) {
            map.setPaintProperty(layer.id, 'line-color', P.ROAD_MINOR);
          } else if (id.includes('admin') || id.includes('boundary')) {
            map.setPaintProperty(layer.id, 'line-color', P.ADMIN);
          } else if (id.includes('building')) {
            map.setPaintProperty(layer.id, 'line-color', P.BUILD_LINE);
          } else {
            map.setPaintProperty(layer.id, 'line-color', P.ROAD_MINOR);
          }
          continue;
        }
        if (layer.type === 'fill-extrusion' && id.includes('building')) {
          // Flatten 3D buildings in older styles
          map.setPaintProperty(layer.id, 'fill-extrusion-height', 0);
          map.setPaintProperty(layer.id, 'fill-extrusion-base', 0);
          map.setPaintProperty(layer.id, 'fill-extrusion-color', P.BUILD);
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
      } catch {
        /* skip unsupported layers */
      }
    }

    try {
      map.setFog({
        range: [0.6, 12],
        color: P.FOG,
        'high-color': P.FOG_HIGH,
        'horizon-blend': 0.08,
        'space-color': P.FOG,
        'star-intensity': P.STAR,
      } as any);
    } catch {}
  };

  // Apply immediately when called from load/style.load handlers. Avoid queuing
  // the palette for the next style.load, which made SearchWalk look one toggle
  // behind (green/dark map with light UI, then inverted on the next tap).
  apply();
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(apply);
  setTimeout(apply, 120);
}
