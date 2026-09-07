import React, { useEffect, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ArrowLeft, Home, Loader2, MessageCircle, Camera, RotateCcw, CheckCircle, Phone, Shield, Clock, Route, PawPrint, Navigation, KeyRound, Gauge, Sun, Moon, X, ChevronDown } from 'lucide-react';
import { PetwalkerChat } from './PetwalkerChat';
import { SupportChat } from './SupportChat';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import type { TransportInfo } from '@/lib/walkerProfile';
import { createDog3DLayer, preloadDog3DAsset, type Dog3DLayer } from '@/lib/dog3dLayer';
import { createCheckpoint3DLayer, preloadCheckpointAsset, type Checkpoint3DLayer } from '@/lib/checkpoint3dLayer';
import { hideMapLabels, tintMapInk, enrichMap } from '@/lib/mapStyle';

interface WalkInProgressProps {
  onBack: () => void;
  onOpenChat: () => void;
  onRequestPhotos: () => void;
  onConfirmArrival: () => void;
  /** Autoriza o retorno — FAIL CLOSED: true somente com confirmação do backend. */
  onAuthorizeReturn?: () => Promise<boolean>;
  /** Disparado quando o cliente confirma o cancelamento do passeio em andamento. */
  onCancelWalk?: () => void;
  /** Disparado quando o pet chega em casa após um cancelamento. */
  onCancelComplete?: () => void;
  /** Quando true, o retorno em andamento é uma animação de cancelamento. */
  isCancelling?: boolean;
  petNames?: string[];
  petIds?: string[];
  petAvatars?: string[];
  petName: string;
  petId: string;
  petAvatar?: string;
  walkerName: string;
  walkerAvatar?: string;
  walkerLocation: [number, number] | null;
  petLocation?: [number, number] | null;
  /**
   * Posição atual REAL do PetWalker, vinda exclusivamente da RPC segura
   * `get_active_walker_location`. Fonte canônica da posição corrente —
   * `route_coordinates` serve apenas para o rastro histórico.
   */
  livePosition?: { lng: number; lat: number; ts: number } | null;
  pickupRoute?: [number, number][];
  isComing?: boolean;
  onPickupComplete?: () => void;
  walkDurationMinutes: number;
  walkStartTime: Date;
  sessionId?: string;
  isDarkMode?: boolean;
  isReturning?: boolean;
  transport?: TransportInfo;
  walkerCode?: string;
  onToggleTheme?: () => void;
  /**
   * 'livre' = walker decides everything → NO planned dashed route on the ground.
   * 'local' = user-defined stops → show dashed planned route ahead of the dog.
   */
  walkType?: 'livre' | 'local';
  /**
   * Local walk stops (in order). Required for walkType === 'local'. The walking
   * route becomes: home → stop1 → … → stopN → home with outbound vs return legs
   * rendered as distinct dashed lines and a numbered pin at each stop.
   */
  localStops?: Array<{ lng: number; lat: number; label?: string }>;
}

// Defensive ordering: trust an explicit `order` field if present, otherwise
// fall back to the array order. Always renumber sequentially 1..N so the pin
// labels can NEVER be out of sync with the IDA → VOLTA flow.
type StopLike = { lng: number; lat: number; label?: string; order?: number };
const orderStops = (stops: StopLike[]): Array<StopLike & { order: number }> => {
  const sorted = [...stops].sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });
  return sorted.map((s, i) => ({ ...s, order: i + 1 }));
};

export const WalkInProgress: React.FC<WalkInProgressProps> = ({
  onBack, onOpenChat, onRequestPhotos, onConfirmArrival,
  onAuthorizeReturn, onCancelWalk, onCancelComplete, isCancelling = false,
  petName, petId, petAvatar, walkerName, walkerAvatar, walkerLocation, petLocation,
  livePosition = null,
  petNames, petIds, petAvatars,
  pickupRoute, isComing = false, onPickupComplete,
  walkDurationMinutes, walkStartTime, sessionId, isDarkMode = false, isReturning = false,
  transport, walkerCode = '0000', onToggleTheme,
  walkType = 'livre',
  localStops = [],
}) => {
  // Resolved stops: starts from the prop, but if the parent passed none AND
  // we have a sessionId for a 'local' walk, we rehydrate from the DB so the
  // pin order (1..N) and the IDA/VOLTA legs survive a hard reload mid-walk.
  const [resolvedStops, setResolvedStops] = useState<Array<{ lng: number; lat: number; label?: string; order?: number }>>(
    () => orderStops(localStops)
  );
  const [resolvedHome, setResolvedHome] = useState<[number, number] | null>(petLocation || walkerLocation);
  useEffect(() => {
    // Always defer to the latest prop if it has data — keeps the parent the
    // source of truth during the same session.
    if (localStops.length > 0) {
      setResolvedStops(orderStops(localStops));
    } else if (walkType === 'local' && sessionId) {
      // Reload path: fetch the persisted stops + home location.
      (async () => {
        try {
          const { data } = await supabase
            .from('walk_sessions')
            .select('local_stops, home_location, current_status')
            .eq('id', sessionId)
            .maybeSingle();
          
          if (data?.current_status === 'completed') {
            onConfirmArrival();
            return;
          }

          const raw = (data?.local_stops as Array<{ lng: number; lat: number; label?: string; order?: number }> | null) ?? [];
          if (raw.length) setResolvedStops(orderStops(raw));
          const hl = data?.home_location as { lng: number; lat: number } | null;
          if (hl && typeof hl.lng === 'number' && typeof hl.lat === 'number') {
            setResolvedHome([hl.lng, hl.lat]);
          }
        } catch (e) {
          console.warn('Failed to rehydrate local walk stops', e);
        }
      })();
    }
  }, [localStops, walkType, sessionId]);

  // When `resolvedStops` populates AFTER the map has already loaded (typical
  // reload-mid-walk path), build the IDA/VOLTA legs and (re)draw the pins so
  // the visual matches the persisted plan immediately.
  useEffect(() => {
    if (walkType !== 'local' || resolvedStops.length === 0) return;
    const home = resolvedHome || petLocation || walkerLocation;
    if (!home) return;
    buildLocalRoute(home, resolvedStops).then(({ outbound, back }) => {
      plannedOutboundRef.current = outbound;
      plannedBackRef.current = back;
      // Only swap the animation route while the dog is actually walking —
      // we don't want to interrupt the pickup animation.
      if (phaseRef.current === 'walking') {
        fillLocalRouteToDuration(outbound, back, walkDurationMinutes).then(({ wander }) => {
          const merged = wander.length > 1
            ? concatLegs(concatLegs(outbound, wander), back)
            : concatLegs(outbound, back);
          setRouteCoordinates(merged);
        });
      }
      // Planned route + pins are visible ONLY after the pickup code is
      // confirmed (phase === 'walking' or 'arrived'). While the walker is
      // still on the way we keep the map free of preview lines/pins.
      if (phaseRef.current !== 'pickup') {
        drawPlannedLocalLayers();
        drawStopPins();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedStops, resolvedHome, walkType]);


  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const walkerMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const petMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const dog3dRefs = useRef<Record<string, Dog3DLayer>>({});
  // Stationary 3D checkpoint pin marking where the pet started the walk.
  const checkpointRef = useRef<Checkpoint3DLayer | null>(null);
  const checkpointPosRef = useRef<[number, number] | null>(null);
  const prevLocForBearingRef = useRef<[number, number] | null>(null);
  const [currentPetLocation, setCurrentPetLocation] = useState<[number, number] | null>(petLocation || walkerLocation);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  const [currentRouteIndex, setCurrentRouteIndex] = useState(0);
  const [distanceWalked, setDistanceWalked] = useState(0);
  const [panelExpanded, setPanelExpanded] = useState(true);
  // Pop-up de chat com o PetWalker (substitui o antigo botão "Encerrar").
  const [chatOpen, setChatOpen] = useState(false);
  // Pop-up de suporte ao vivo VaiPet (acionado pelo botão "Precisa de ajuda?").
  const [supportOpen, setSupportOpen] = useState(false);
  const cancelFiredRef = useRef(false);
  const [phase, setPhase] = useState<'pickup' | 'arrived' | 'walking'>(() => {
    if (sessionId) {
      const saved = sessionStorage.getItem(`vaipet_walk_phase_${sessionId}`);
      if (saved === 'walking' || saved === 'arrived' || saved === 'pickup') return saved as 'pickup' | 'arrived' | 'walking';
    }
    return isComing ? 'pickup' : 'walking';
  });
  const phaseRef = useRef<'pickup' | 'arrived' | 'walking'>(phase);
  const isComingRef = useRef(isComing);
  const [menuOpen, setMenuOpen] = useState(false);
  const [returnRequestLoading, setReturnRequestLoading] = useState(false);
  const [walkStartedAt, setWalkStartedAt] = useState<Date | null>(isComing ? null : walkStartTime);
  const [etaSec, setEtaSec] = useState<number>(0);
  const [remainingMeters, setRemainingMeters] = useState<number>(0);
  const [codeInput, setCodeInput] = useState<string>('');
  const [codeError, setCodeError] = useState(false);
  const [concluding, setConcluding] = useState(false);
  const animRef = useRef<number | null>(null);
  const lastLocRef = useRef<[number, number] | null>(null);
  const stopMarkersRef = useRef<mapboxgl.Marker[]>([]);
  // Persisted breadcrumb of every position the pet has actually been at.
  // Seeded from DB on mount so reopening the screen NEVER loses the trail.
  // Appended (not replaced) during the entire walk — including the return.
  const persistedTrailRef = useRef<[number, number][]>([]);
  const lastTrailAppendRef = useRef<[number, number] | null>(null);
  const lastTrailSaveAtRef = useRef<number>(0);
  const lastSavedTrailLenRef = useRef<number>(0);
  const trailLoadedRef = useRef(false);
  const didSkipInitialThemeSyncRef = useRef(false);
  const cinematicBearingRef = useRef(-24);
  const pathBearingRef = useRef(-24);
  // True once the user manually interacts with the map (drag/zoom/rotate).
  // While false during pickup we keep both walker + pet in frame.
  // After the user takes control, we switch to a close follow on the walker.
  // Timestamp (ms) of last manual map interaction. The auto-follow camera
  // stays paused for 25s after any drag/zoom/rotate/pitch so the user can
  // freely explore the map without being snapped back.
  const lastUserInteractionRef = useRef<number>(0);
  const AUTO_FOLLOW_IDLE_MS = 25000;
  const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
  // 3x boost for the in-app test flow so the walker reaches the pet much
  // faster than real-world transport speed during demos.
  const PICKUP_TEST_BOOST = 3;
  const pickupSpeedMs = ((transport?.speedKmh ?? 9) * 1000 / 3600) * PICKUP_TEST_BOOST;

  useEffect(() => {
    preloadDog3DAsset().catch(() => {});
    preloadCheckpointAsset().catch(() => {});
  }, []);

  // ------------------------------------------------------------------
  // Trail persistence: load existing breadcrumb from DB so reopening
  // the screen mid-walk shows EVERY point already walked, not a fresh
  // line. The trail is kept in a ref + mirrored into the map source.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!sessionId || trailLoadedRef.current) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('walk_sessions')
          .select('route_coordinates')
          .eq('id', sessionId)
          .maybeSingle();
        const raw = (data?.route_coordinates as [number, number][] | null) || [];
        // Defensive sanitize: keep only [lng,lat] tuples.
        const clean = raw.filter(
          (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
        ) as [number, number][];
        persistedTrailRef.current = clean;
        lastSavedTrailLenRef.current = clean.length;
        lastTrailAppendRef.current = clean[clean.length - 1] || null;
        trailLoadedRef.current = true;
        // If the map already loaded before the DB responded, push the
        // saved breadcrumb into the source so it appears right away.
        const src = map.current?.getSource('walk-trail') as mapboxgl.GeoJSONSource | undefined;
        if (src && clean.length > 0) {
          src.setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: clean },
          });
        }
        // If we just loaded a trail and we were at the start, jump to the last point
        if (clean.length > 0 && !lastLocRef.current && phaseRef.current === 'walking') {
          const last = clean[clean.length - 1];
          lastLocRef.current = last;
          Object.values(dog3dRefs.current).forEach(layer => layer.setPosition(last));
        }
      } catch (e) {
        console.warn('Failed to load persisted walk trail', e);
        trailLoadedRef.current = true;
      }
    })();
  }, [sessionId]);

  // Append a point to the persisted trail if it moved enough.
  //
  // IMPORTANT: when the user reopens a walk that was already in progress
  // we seed `persistedTrailRef` from the DB. The walking simulation, however,
  // always restarts from the beginning of the planned route — so the first
  // ticks would create a HUGE jump from the last real position to the
  // planned route's start, drawing bogus segments across the city.
  //
  // To prevent that we reject any append that is suspiciously far from the
  // previous trail point (a teleport, not a real walk step). We just slide
  // the "last" anchor to the new location so the trail can resume cleanly
  // once the simulation reaches the actual neighbourhood again.
  const TRAIL_MAX_STEP_M = 60; // anything bigger is treated as a teleport
  const appendTrailPoint = (loc: [number, number]): [number, number][] => {
    const last = lastTrailAppendRef.current;
    if (!last) {
      persistedTrailRef.current.push(loc);
      lastTrailAppendRef.current = loc;
      return persistedTrailRef.current;
    }
    const d = haversine(last, loc);
    if (d < 2) return persistedTrailRef.current;       // duplicate
    if (d > TRAIL_MAX_STEP_M) {
      // Teleport (resume / route swap). Don't draw a fake straight line.
      lastTrailAppendRef.current = loc;
      return persistedTrailRef.current;
    }
    persistedTrailRef.current.push(loc);
    lastTrailAppendRef.current = loc;
    return persistedTrailRef.current;
  };

  // Periodic DB save of the full persisted trail. Runs every 4s while
  // the walk is active so the breadcrumb survives reloads, app kills,
  // tab switches, etc.
  useEffect(() => {
    if (!sessionId) return;
    // Note: Owner side is READ-ONLY for tracking.
    // Real-time location updates are received via standard Supabase subscription
    // handled by the parent component or local realtime logic.
  }, [sessionId]);


  useEffect(() => {
    phaseRef.current = phase;
    isComingRef.current = isComing;
    if (sessionId) {
      sessionStorage.setItem(`vaipet_walk_phase_${sessionId}`, phase);
    }
  }, [phase, isComing, sessionId]);

  // Haversine distance in meters between two [lng,lat] points
  const haversine = (a: [number, number], b: [number, number]) => {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLng = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };

  // Fetch real walking directions between two points.
  // IMPORTANT: on failure we return an EMPTY array (not [a,b]) so the caller
  // can skip the broken segment instead of drawing a straight line that cuts
  // across blocks, buildings or water — that was the "pet vai pro meio do
  // nada" bug.
  const fetchWalkingRoute = async (a: [number, number], b: [number, number]): Promise<[number, number][]> => {
    try {
      const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/walking/${a[0]},${a[1]};${b[0]},${b[1]}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`);
      const json = await res.json();
      if (json.routes?.[0]?.geometry?.coordinates) return json.routes[0].geometry.coordinates as [number, number][];
    } catch { /* ignorado */ }
    return [];
  };

  // Fetch a real walking route across MANY waypoints in a single Mapbox
  // Directions request. This keeps the path coherent and snapped to actual
  // streets — much better than chaining N independent A→B requests, which
  // can produce weird detours when intermediate points fall off-road.
  const fetchWalkingRouteMulti = async (points: [number, number][]): Promise<[number, number][]> => {
    if (points.length < 2) return points.slice();
    const coords = points.map(p => `${p[0]},${p[1]}`).join(';');
    // Retry with wider road-snapping radiuses. Google POI centers (malls,
    // parks, stations) are often inside the property and >50m away from the
    // nearest walkable Mapbox segment; a too-strict radius made LOCAL routes
    // occasionally come back empty, so the trace disappeared after the PIN.
    for (const radius of [50, 120, 250]) {
      try {
        const radiuses = points.map(() => String(radius)).join(';');
        const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?geometries=geojson&overview=full&radiuses=${radiuses}&access_token=${MAPBOX_TOKEN}`);
        const json = await res.json();
        if (json.routes?.[0]?.geometry?.coordinates) return json.routes[0].geometry.coordinates as [number, number][];
      } catch { /* ignorado */ }
    }
    try {
      const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`);
      const json = await res.json();
      if (json.routes?.[0]?.geometry?.coordinates) return json.routes[0].geometry.coordinates as [number, number][];
    } catch { /* ignorado */ }
    return [];
  };

  const buildSequentialWalkingRoute = async (points: [number, number][]): Promise<[number, number][]> => {
    if (points.length < 2) return points.slice();
    const merged: [number, number][] = [];
    for (let i = 1; i < points.length; i++) {
      const leg = await fetchWalkingRouteMulti([points[i - 1], points[i]]);
      const safeLeg = leg.length >= 2 ? leg : [points[i - 1], points[i]];
      merged.push(...(merged.length ? safeLeg.slice(1) : safeLeg));
    }
    return merged;
  };

  // Build a continuous forward-moving walk segment for LIVRE mode.
  // OLD behaviour: hexagonal loop that returned to `center`, which made the
  // pet visibly "ir e voltar" every ~300m. NEW behaviour: pick a random
  // direction (gently biased to continue from the previous heading when
  // available) and walk ~250m through 1-2 intermediate waypoints to keep
  // the path on real streets. The next call resumes from the new end
  // point, producing one continuous exploration walk.
  const lastLivreHeadingRef = useRef<number | null>(null);
  const buildWalkLoop = async (start: [number, number]): Promise<[number, number][]> => {
    const rMeters = 250;
    const dLat = rMeters / 111320;
    const dLng = rMeters / (111320 * Math.cos((start[1] * Math.PI) / 180));
    // Heading: continue forward with a gentle ±45° wiggle so the dog
    // doesn't U-turn. First segment is fully random.
    const baseHeading = lastLivreHeadingRef.current ?? Math.random() * Math.PI * 2;
    const heading = baseHeading + (Math.random() - 0.5) * (Math.PI / 2);
    const mid: [number, number] = [
      start[0] + Math.cos(heading) * dLng * 0.55,
      start[1] + Math.sin(heading) * dLat * 0.55,
    ];
    // Add a small lateral kink so Mapbox snaps to real streets instead of
    // a perfectly straight line through buildings.
    const sideAngle = heading + Math.PI / 2;
    const kink: [number, number] = [
      mid[0] + Math.cos(sideAngle) * dLng * 0.08 * (Math.random() < 0.5 ? -1 : 1),
      mid[1] + Math.sin(sideAngle) * dLat * 0.08 * (Math.random() < 0.5 ? -1 : 1),
    ];
    const end: [number, number] = [
      start[0] + Math.cos(heading) * dLng,
      start[1] + Math.sin(heading) * dLat,
    ];
    const full = await fetchWalkingRouteMulti([start, kink, end]);
    if (full.length >= 2) {
      lastLivreHeadingRef.current = heading;
      return full;
    }
    // Retry: just A→B, accept a shorter route if available.
    const retry = await fetchWalkingRouteMulti([start, end]);
    if (retry.length >= 2) {
      lastLivreHeadingRef.current = heading;
      return retry;
    }
    return [start];
  };

  // Build a real two-leg route for LOCAL walks: home → stops (outbound)
  // and last stop → home (return). Both legs are routed on real walking
  // roads via Mapbox Directions.
  const buildLocalRoute = async (
    home: [number, number],
    stops: Array<{ lng: number; lat: number }>
  ): Promise<{ outbound: [number, number][]; back: [number, number][] }> => {
    if (!stops.length) return { outbound: [home], back: [home] };
    const points: [number, number][] = [home, ...stops.map(s => [s.lng, s.lat] as [number, number])];
    // Single multi-waypoint request keeps every leg snapped to roads with a
    // consistent network plan (avoids the "detour through nowhere" effect
    // we got from chaining independent A→B requests).
    const outboundMulti = await fetchWalkingRouteMulti(points);
    const outbound: [number, number][] = outboundMulti.length >= 2
      ? outboundMulti
      : await buildSequentialWalkingRoute(points);
    const last = points[points.length - 1];
    const backMulti = await fetchWalkingRouteMulti([last, home]);
    const back: [number, number][] = backMulti.length >= 2
      ? backMulti
      : await buildSequentialWalkingRoute([last, home]);
    return { outbound, back };
  };

  // Total walking distance along a polyline (meters).
  const polyLengthMeters = (path: [number, number][]): number => {
    let s = 0;
    for (let i = 1; i < path.length; i++) s += haversine(path[i - 1], path[i]);
    return s;
  };

  // Build a wandering loop AROUND a stop that the dog can roam through to
  // fill the planned walk duration. Without this, short LOCAL routes (e.g.
  // a stop 50m from home) finish in ~2min and the pet sits idle at home
  // for the rest of the planned 30min — which the user perceived as
  // "saiu uns 50m, voltou e parou". The loop generates random waypoints
  // within `radiusMeters` of `around`, routes them on real streets, and
  // keeps appending until `targetMeters` of extra path are accumulated.
  // Always returns a path that starts AND ends at `around` so it can be
  // safely spliced between outbound and back legs.
  const buildWanderingExtension = async (
    around: [number, number],
    targetMeters: number,
    radiusMeters: number = 350,
  ): Promise<[number, number][]> => {
    if (targetMeters < 80) return [around];
    const dLatPerM = 1 / 111320;
    const dLngPerM = 1 / (111320 * Math.cos((around[1] * Math.PI) / 180));
    const out: [number, number][] = [around];
    let acc = 0;
    let cur: [number, number] = around;
    let lastHeading = Math.random() * Math.PI * 2;
    let guard = 0;
    while (acc < targetMeters && guard++ < 24) {
      // Pick a target inside the radius around `around`, biased to keep
      // moving forward from the last heading (avoids ping-ponging back to
      // the same spot).
      const heading = lastHeading + (Math.random() - 0.5) * (Math.PI / 1.2);
      const dist = radiusMeters * (0.5 + Math.random() * 0.5);
      const target: [number, number] = [
        around[0] + Math.cos(heading) * dist * dLngPerM,
        around[1] + Math.sin(heading) * dist * dLatPerM,
      ];
      const leg = await fetchWalkingRouteMulti([cur, target]);
      if (leg.length < 2) continue;
      out.push(...leg.slice(1));
      acc += polyLengthMeters(leg);
      cur = leg[leg.length - 1];
      lastHeading = heading;
    }
    // Close the loop: route back to the original stop so the spliced
    // segment is continuous with the planned "back" leg.
    const closer = await fetchWalkingRouteMulti([cur, around]);
    if (closer.length >= 2) out.push(...closer.slice(1));
    else out.push(around);
    return out;
  };

  // Splice a wander loop between outbound and back so the total walking
  // distance roughly fills the planned duration. Uses ~1.0 m/s as the
  // realistic walking pace target. Skips if the planned legs already
  // cover enough distance.
  const fillLocalRouteToDuration = async (
    outbound: [number, number][],
    back: [number, number][],
    durationMinutes: number,
  ): Promise<{ outbound: [number, number][]; back: [number, number][]; wander: [number, number][] }> => {
    if (!durationMinutes || durationMinutes < 3 || outbound.length < 2 || back.length < 2) {
      return { outbound, back, wander: [] };
    }
    const have = polyLengthMeters(outbound) + polyLengthMeters(back);
    // Reserve ~1.5 min for pickup transitions / arrival; aim for ~1.0 m/s.
    const targetTotal = Math.max(0, (durationMinutes - 1.5) * 60 * 1.0);
    const gap = targetTotal - have;
    if (gap < 120) return { outbound, back, wander: [] };
    const around = outbound[outbound.length - 1];
    const wander = await buildWanderingExtension(around, gap);
    return { outbound, back, wander };
  };

  // Helper: build the unified animation route (outbound + return) so the dog
  // walks the entire planned path in one continuous animation.
  const concatLegs = (a: [number, number][], b: [number, number][]): [number, number][] => {
    if (!a.length) return b;
    if (!b.length) return a;
    return [...a, ...b.slice(1)];
  };

  // Planned-leg state: kept in refs so re-renders don't reset them.
  const plannedOutboundRef = useRef<[number, number][]>([]);
  const plannedBackRef = useRef<[number, number][]>([]);
  const returnRouteRef = useRef<[number, number][]>([]);
  // Animation loop for the pulsing dashed planned route. Keeps a single
  // RAF running while planned layers exist so the dashes "flow" from the
  // start of the leg toward the destination, like a directional trail.
  const dashAnimRef = useRef<number | null>(null);
  const dashAnimStartRef = useRef<number>(0);
  // Refs sincronizados com o progresso real do passeio. Usados dentro do
  // RAF de animação do tracejado para mapear a posição da onda luminosa
  // ao quanto do passeio já se passou (0 no início, 1 no fim).
  const walkStartedAtAnimRef = useRef<Date | null>(null);
  const walkTotalSecAnimRef = useRef<number>(0);

  const drawPlannedLocalLayers = () => {
    if (!map.current) return;
    // Don't add empty/placeholder sources — wait until the planned legs
    // are actually computed. Empty sources render nothing AND prevent the
    // subsequent (real) draw from re-adding the source because the
    // `getSource()` check returns true. This was the main cause of the
    // "after starting the walk the dashed route disappeared" bug.
    if (
      plannedOutboundRef.current.length < 2 &&
      plannedBackRef.current.length < 2
    ) {
      return;
    }
    if (!map.current.isStyleLoaded()) {
      // Style not ready yet — retry once it is. This prevents the
      // planned route from being silently dropped when the user confirms
      // the pickup code right before a style swap finishes.
      map.current.once('idle', () => drawPlannedLocalLayers());
      return;
    }
    const m = map.current;
    const outboundData: GeoJSON.Feature = {
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: plannedOutboundRef.current },
    };
    const backData: GeoJSON.Feature = {
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: plannedBackRef.current },
    };
    // SUBTLE dotted preview line — no glow, no thick base, just a thin
    // dotted overlay that flows forward as a directional cue. As the dog
    // walks the planned source is trimmed (see tick loop) so the dots
    // disappear behind the pet, leaving only the real breadcrumb.
    const ensureLeg = (sourceId: string, data: GeoJSON.Feature, color: string) => {
      const dashId = `${sourceId}-dash`;
      const pulseId = `${sourceId}-pulse`;
      const beforeId = m.getLayer('vp-dog-3d')
        ? 'vp-dog-3d'
        : (m.getLayer('vp-checkpoint-3d') ? 'vp-checkpoint-3d' : undefined);
      if (!m.getSource(sourceId)) {
        m.addSource(sourceId, { type: 'geojson', lineMetrics: true, data });
      } else {
        (m.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(data);
      }
      if (!m.getLayer(dashId)) {
        m.addLayer({
          id: dashId, type: 'line', source: sourceId,
          paint: {
            'line-color': color,
            'line-width': 3,
            // Discreto: 20% de opacidade. Não compete com o rastro verde.
            'line-opacity': 0.2,
            // Pontilhado curto, estilo "bolinhas".
            'line-dasharray': [0.6, 4],
          },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        }, beforeId);
      }
      // Overlay luminoso animado: uma "onda" linear desliza do início ao
      // fim da rota indicando a direção. line-gradient é atualizado por
      // frame em startDashPulse() — aqui só registramos a camada com um
      // gradiente neutro inicial.
      if (!m.getLayer(pulseId)) {
        m.addLayer({
          id: pulseId, type: 'line', source: sourceId,
          paint: {
            'line-width': 3,
            'line-opacity': 0.95,
            // Mantém o visual pontilhado da rota: a onda luminosa também
            // é desenhada como tracejado curto, sobreposta ao traço base,
            // evitando que o pico vire um traço sólido brilhante.
            'line-dasharray': [0.6, 4],
            'line-gradient': [
              'interpolate', ['linear'], ['line-progress'],
              0, 'rgba(255,255,255,0)',
              1, 'rgba(255,255,255,0)',
            ] as mapboxgl.Expression,
          },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        }, beforeId);
      }
    };
    if (plannedOutboundRef.current.length >= 2) {
      ensureLeg('planned-outbound', outboundData, '#31D880');
    }
    if (plannedBackRef.current.length >= 2) {
      ensureLeg('planned-back', backData, '#31D880');
    }
    startDashPulse();
  };

  // Uber-style animated trail: a solid base line is always visible, and a
  // shorter bright dash flows forward over it via a faked "dash offset"
  // (Mapbox GL JS has no native dash-offset, so we cycle the leading gap
  // of the dash pattern). The glow layer pulses softly in opacity for
  // life. ~60fps RAF, throttled when the tab is hidden.
  const startDashPulse = () => {
    if (dashAnimRef.current != null) return;
    dashAnimStartRef.current = performance.now();
    // Onda luminosa sincronizada com o PROGRESSO REAL do passeio:
    //   • Inicia no exato instante em que o passeio começa (head=0).
    //   • Atravessa a IDA (home → destino) durante a primeira metade
    //     do tempo planejado, e a VOLTA (destino → home) na segunda.
    //   • Termina exatamente quando o tempo planejado se esgota
    //     (head=1 no fim da rota de volta).
    // Antes do passeio iniciar (fase de pickup), cai num loop curto só
    // para sinalizar visualmente que a rota está pronta.
    const WIDTH = 0.18;
    const FALLBACK_S = 2.6; // loop usado enquanto walkStartedAt == null
    const buildPulseGradient = (color: string, head: number) => {
      // head é a posição (0..1) do PICO de brilho na rota. Construímos
      // um gradiente: transparente → brilho no pico → transparente,
      // garantindo sempre stops crescentes em 0..1.
      const c = (a: number) => {
        if (color === '#31D880') return `rgba(49,216,128,${a})`;
        return `rgba(49,216,128,${a})`;
      };
      // Onda fora do trecho visível: gradiente totalmente transparente.
      if (head <= 0 || head >= 1) {
        return ['interpolate', ['linear'], ['line-progress'], 0, c(0), 1, c(0)] as mapboxgl.Expression;
      }
      const tail = Math.max(0, head - WIDTH);
      const lead = Math.min(1, head + WIDTH);
      const stops: (string | number | mapboxgl.Expression)[] = ['interpolate', ['linear'], ['line-progress']];
      stops.push(0, c(0));
      if (tail > 0) stops.push(tail, c(0));
      stops.push(head, c(0.55));
      if (lead < 1) stops.push(lead, c(0));
      stops.push(1, c(0));
      return stops as mapboxgl.Expression;
    };
    const step = () => {
      const m = map.current;
      const hasLayer = m && (
        m.getLayer('planned-outbound-pulse') ||
        m.getLayer('planned-back-pulse') ||
        m.getLayer('return-route-dash')
      );
      if (!m || !hasLayer) {
        dashAnimRef.current = null;
        return;
      }
      const t = (performance.now() - dashAnimStartRef.current) / 1000;
      // ---------- Cálculo do progresso ----------
      const startedAt = walkStartedAtAnimRef.current;
      const totalSec = walkTotalSecAnimRef.current;
      let outboundHead: number;
      let backHead: number;
      let showBack = true;
      if (startedAt && totalSec > 0) {
        // Passeio em andamento: progresso real (0..1) do tempo planejado.
        const elapsed = (Date.now() - startedAt.getTime()) / 1000;
        const progress = Math.max(0, Math.min(1, elapsed / totalSec));
        if (progress < 0.5) {
          // Primeira metade: onda percorre a IDA. VOLTA fica oculta.
          outboundHead = progress * 2;
          backHead = 0;
          showBack = false;
        } else {
          // Segunda metade: IDA permanece cheia (head=1, fora da faixa
          // visível por ter passado), VOLTA percorre do destino até home.
          outboundHead = 1 + WIDTH; // garante onda já fora da rota
          backHead = (progress - 0.5) * 2; // 0..1 (destino → home)
        }
      } else {
        // Antes do passeio iniciar: loop suave do início ao fim das duas pernas
        const cyc = (t % FALLBACK_S) / FALLBACK_S;
        const h = -WIDTH + cyc * (1 + 2 * WIDTH);
        outboundHead = Math.max(0, Math.min(1, h));
        backHead = 1 - outboundHead;
      }
      try {
        if (m.getLayer('planned-outbound-pulse')) {
          m.setPaintProperty('planned-outbound-pulse', 'line-gradient', buildPulseGradient('#31D880', outboundHead));
        }
        if (m.getLayer('planned-back-pulse')) {
          // A geometria da rota de volta é [destino → origem]. Como o
          // progresso da segunda metade já reflete destino→home
          // diretamente, passamos `backHead` sem inverter. Quando ainda
          // estamos na IDA, escondemos a onda da volta (head<0).
          const h = showBack ? backHead : -WIDTH * 2;
          m.setPaintProperty('planned-back-pulse', 'line-gradient', buildPulseGradient('#31D880', h));
        }
        if (m.getLayer('return-route-dash')) {
          // legado: mantém um leve pulsar de dasharray na rota de retorno
          const DOT = 1.4, GAP = 2.4, PERIOD = DOT + GAP;
          const phase = (t * 1.8) % PERIOD;
          const lead = Math.max(0.001, PERIOD - phase);
          m.setPaintProperty('return-route-dash', 'line-dasharray', [lead, DOT, GAP, DOT, GAP, DOT, GAP, DOT, GAP]);
        }
      } catch { /* ignorado */ }
      dashAnimRef.current = requestAnimationFrame(step);
    };
    dashAnimRef.current = requestAnimationFrame(step);
  };

  const stopDashPulse = () => {
    if (dashAnimRef.current != null) {
      cancelAnimationFrame(dashAnimRef.current);
      dashAnimRef.current = null;
    }
  };

  // Remove planned route + stop pins from the map. Used while the walker is
  // still on the way (phase === 'pickup'): the user only wants to see the
  // upcoming pet route AFTER the pickup code is confirmed.
  const clearPlannedLocalLayers = () => {
    const m = map.current;
    if (!m) return;
    stopDashPulse();
    [
      'planned-outbound-dash', 'planned-outbound-pulse', 'planned-outbound-base', 'planned-outbound-glow',
      'planned-back-dash', 'planned-back-pulse', 'planned-back-base', 'planned-back-glow',
    ].forEach(id => {
      if (m.getLayer(id)) m.removeLayer(id);
    });
    ['planned-outbound', 'planned-back'].forEach(id => {
      if (m.getSource(id)) m.removeSource(id);
    });
    stopMarkersRef.current.forEach(mk => mk.remove());
    stopMarkersRef.current = [];
  };

  const drawHomeCheckpoint = (home: [number, number]) => {
    const m = map.current;
    if (!m) return;
    checkpointPosRef.current = home;
    const ensure = () => {
      if (!map.current || !map.current.isStyleLoaded()) return;
      // SEMPRE recria o layer fresh aqui. A versão pré-criada e "escondida"
      // no map load funcionava no modo claro mas, no modo escuro, o GLB
      // carregado async dentro de uma camada inicialmente invisível não
      // renderizava na primeira chamada de setVisible(true) — só após
      // uma troca de tema (que recriava a camada do zero). Recriar aqui
      // garante render imediato em ambos os temas, e é barato porque o
      // GLB já está em cache (preloadCheckpointAsset).
      try { if (map.current.getLayer('vp-checkpoint-3d')) map.current.removeLayer('vp-checkpoint-3d'); } catch { /* ignorado */ }
      const cp = createCheckpoint3DLayer('vp-checkpoint-3d', home, { color: '#31D880', targetSizeMeters: 8, groundOffsetMeters: 0.25 });
      checkpointRef.current = cp;
      map.current.addLayer(cp);
      cp.setPosition(home);
      cp.setVisible(true);
      try { map.current.moveLayer('vp-checkpoint-3d'); } catch { /* ignorado */ }
      try { map.current.triggerRepaint(); } catch { /* ignorado */ }
    };
    // Run synchronously when possible AND defer once via rAF so a
    // freshly-added custom 3D layer gets its first render in the same
    // paint frame as the dog (Mapbox occasionally skips the very first
    // frame for layers added inside a click handler).
    if (m.isStyleLoaded()) {
      ensure();
      requestAnimationFrame(() => { try { ensure(); } catch { /* ignorado */ } });
    } else {
      m.once('style.load', ensure);
      m.once('idle', ensure);
    }
  };

  const drawReturnRoute = (coords: [number, number][]) => {
    const m = map.current;
    if (!m || coords.length < 2) return;
    returnRouteRef.current = coords;
    if (!m.isStyleLoaded()) {
      m.once('idle', () => drawReturnRoute(returnRouteRef.current));
      return;
    }
    const data: GeoJSON.Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    };
    const beforeId = m.getLayer('vp-dog-3d')
      ? 'vp-dog-3d'
      : (m.getLayer('vp-checkpoint-3d') ? 'vp-checkpoint-3d' : undefined);
    if (!m.getSource('return-route')) {
      m.addSource('return-route', { type: 'geojson', data });
    } else {
      (m.getSource('return-route') as mapboxgl.GeoJSONSource).setData(data);
    }
    if (!m.getLayer('return-route-glow')) {
      m.addLayer({
        id: 'return-route-glow', type: 'line', source: 'return-route',
        paint: { 'line-color': '#31D880', 'line-width': 13, 'line-opacity': 0.18, 'line-blur': 7 },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      }, beforeId);
    }
    if (!m.getLayer('return-route-base')) {
      m.addLayer({
        id: 'return-route-base', type: 'line', source: 'return-route',
        paint: { 'line-color': '#31D880', 'line-width': 5, 'line-opacity': 0.42 },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      }, beforeId);
    }
    if (!m.getLayer('return-route-dash')) {
      m.addLayer({
        id: 'return-route-dash', type: 'line', source: 'return-route',
        paint: { 'line-color': '#FFFFFF', 'line-width': 4, 'line-opacity': 0.95, 'line-dasharray': [0, 4, 3, 4] },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      }, beforeId);
    }
    startDashPulse();
  };

  const drawStopPins = () => {
    const m = map.current;
    // Guard: o mapa pode existir mas ainda não ter terminado de carregar
    // (getCanvasContainer() retorna undefined nesse caso). Sem isso, o
    // marker.addTo() crashava com "Cannot read properties of undefined
    // (reading 'appendChild')" quando o effect de mudança de fase
    // disparava drawStopPins() antes do 'load'.
    if (!m || typeof m.getCanvasContainer !== 'function' || !m.getCanvasContainer()) return;
    // Clear previous pins
    stopMarkersRef.current.forEach(m => m.remove());
    stopMarkersRef.current = [];
    // Always render from the canonical `resolvedStops` list — its order is
    // re-numbered 1..N every time it's set, so a stale or shuffled DB row
    // can never produce out-of-sequence pin labels.
    resolvedStops.forEach((s, idx) => {
      const n = s.order ?? idx + 1;
      const el = document.createElement('div');
      // Circular numbered pin — pixel-accurate. `anchor: 'center'` places the
      // exact center of this 34px circle on the stop coordinate so the pin
      // never appears displaced from the address it represents (no rotation
      // hacks that would offset the visual centre from the layout box).
      el.innerHTML = `
        <div style="width:34px;height:34px;border-radius:50%;background:#31D880;border:3px solid white;box-shadow:0 6px 14px rgba(0,169,120,0.45);display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:14px;font-family:Mulish,system-ui,sans-serif;line-height:1;">
          ${n}
        </div>
      `;
      try {
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([s.lng, s.lat])
          .addTo(m);
        stopMarkersRef.current.push(marker);
      } catch { /* ignorado */
        // Silencioso: se o mapa for desmontado entre o guard e o addTo
        // (race em hot-reload), apenas ignora — o próximo ciclo redesenha.
      }
    });
  };

  useEffect(() => {
    if (!walkStartedAt) { setElapsedTime(0); setDistanceWalked(0); return; }
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - walkStartedAt.getTime()) / 1000);
      setElapsedTime(elapsed);
      setDistanceWalked(parseFloat((elapsed * 0.002).toFixed(2)));
    }, 1000);
    return () => clearInterval(interval);
  }, [walkStartedAt]);

  // Mantém o RAF de animação do tracejado sincronizado com o passeio:
  // assim que walkStartedAt vira uma Date real e o tempo planejado é
  // conhecido, a onda passa a refletir o progresso real (0..1).
  useEffect(() => {
    walkStartedAtAnimRef.current = walkStartedAt;
    walkTotalSecAnimRef.current = (walkDurationMinutes || 0) * 60;
  }, [walkStartedAt, walkDurationMinutes]);

  // Whenever the layout changes (phase swap removes the bottom panel /
  // max-width wrapper), Mapbox keeps the old canvas size and leaves a gray
  // strip. Force a resize so the map fills 100% of the new container.
  // Sync map style with isDarkMode prop (Day/Night transition).
  useEffect(() => {
    if (!map.current) return;
    const m = map.current;
    const applyStyle = () => {
      try {
        const isDay = !isDarkMode;
        m.setConfigProperty('basemap', 'lightPreset', isDay ? 'day' : 'night');
        m.setConfigProperty('basemap', 'theme', isDay ? 'faded' : 'default');
        
        if (isDay) {
          // Explicitly set the pastel palette for day mode
          m.setConfigProperty('basemap', 'colorLand', "#F2F1E8");
          m.setConfigProperty('basemap', 'colorWater', "#D5E8E5");
          m.setConfigProperty('basemap', 'colorGreenspace', "#C5DEBC");
          m.setConfigProperty('basemap', 'colorRoads', "#FFFFFF");
          m.setConfigProperty('basemap', 'colorTrunks', "#F5EEDB");
          m.setConfigProperty('basemap', 'colorMotorways', "#EEE4C8");
          m.setConfigProperty('basemap', 'colorBuildings', "#E6E3D8");
          m.setConfigProperty('basemap', 'colorRoadLabels', "#84908A");
          m.setConfigProperty('basemap', 'colorPlaceLabels', "#46534D");
        } else {
          // Reset to default for night mode
          m.setConfigProperty('basemap', 'colorLand', null);
          m.setConfigProperty('basemap', 'colorWater', null);
          m.setConfigProperty('basemap', 'colorGreenspace', null);
          m.setConfigProperty('basemap', 'colorRoads', null);
          m.setConfigProperty('basemap', 'colorBuildings', null);
        }
        
        hideMapLabels(m);
        enrichMap(m, isDay);
        tintMapInk(m, !isDay);
      } catch (e) {
        console.warn('Failed to update walk map theme:', e);
      }
    };
    if (m.isStyleLoaded()) {
      applyStyle();
    } else {
      m.once('styledata', applyStyle);
    }
  }, [isDarkMode]);

  useEffect(() => {
    if (!map.current || !mapContainer.current) return;
    const m = map.current;
    const doResize = () => m.resize();
    // Resize after the DOM has reflowed for the phase swap.
    const t = setTimeout(doResize, 0);
    // IMPORTANT: do NOT attach a ResizeObserver to mapContainer. The floating
    // bottom pills + safe-area animations cause sub-pixel container size
    // oscillations every frame, which triggered `m.resize()` repeatedly and
    // made the canvas visibly "piscar" while the camera was easing. Window
    // resize / orientation change are the only legitimate triggers here.
    window.addEventListener('resize', doResize);
    window.addEventListener('orientationchange', doResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', doResize);
      window.removeEventListener('orientationchange', doResize);
    };
  }, [phase, isReturning]);

  // ────────────────────────────────────────────────────────────────
  // Estado/refs do marcador de posição AO VIVO. Declarados ANTES do
  // efeito do mapa porque a limpeza do mapa precisa soltá-los, e o
  // marcador precisa ser (re)criado assim que o mapa emitir `load`.
  // ────────────────────────────────────────────────────────────────
  const liveMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const liveAnimRef = useRef<number | null>(null);
  const liveLastRef = useRef<{ lng: number; lat: number; ts: number } | null>(null);
  // Última coordenada conhecida, guardada mesmo antes de o mapa carregar.
  const pendingLiveRef = useRef<{ lng: number; lat: number; ts: number } | null>(null);
  const [mapReadyTick, setMapReadyTick] = useState(0);

  useEffect(() => {
    if (!mapContainer.current || !walkerLocation) return;
    // Guard: this effect must initialize the map exactly ONCE. The
    // dependency array intentionally fires whenever `walkerLocation`
    // first becomes available, but the parent can keep updating
    // walkerLocation during the simulation — without this guard every
    // such update would tear down and rebuild the entire map, which is
    // exactly the "screen flashes, route resets, goes back to 'a
    // caminho'" bug the user reported.
    if (map.current) return;
    // Only the run that ACTUALLY created the map is allowed to tear it
    // down. Without this flag every `walkerLocation`/`petLocation` update
    // (e.g. the parent seeding the first live coordinate) ran the cleanup
    // of the previous run and destroyed the map — while the creation guard
    // above prevented it from ever being rebuilt. Result: blank map and a
    // live marker detached from the DOM.
    let createdHere = false;
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;
    // When the walker is coming to pick up, start the camera around the
    // PET (where the user was looking in the search map) and then smoothly
    // travel to the walker on load — avoids the abrupt "flick" the user
    // saw when the walking screen mounted.
    const startCenter = isComing ? (petLocation || walkerLocation) : (petLocation || walkerLocation);
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/standard",
      center: startCenter,
      zoom: isComing ? 15 : 16,
      pitch: 45,
      bearing: -17.6,
      config: {
        basemap: {
          lightPreset: isDarkMode ? "night" : "day",
          theme: isDarkMode ? "default" : "faded",
          show3dObjects: false,
          colorLand: "#F2F1E8",
          colorWater: "#D5E8E5",
          colorGreenspace: "#C5DEBC",
          colorRoads: "#FFFFFF",
          colorTrunks: "#F5EEDB",
          colorMotorways: "#EEE4C8",
          colorBuildings: "#E6E3D8",
          colorRoadLabels: "#84908A",
          colorPlaceLabels: "#46534D"
        }
      }
    });

    // Initial route: if coming, use the pickup road route; otherwise build a walking loop
    if (isComing && pickupRoute && pickupRoute.length > 1) {
      setRouteCoordinates(pickupRoute);
    } else if (walkType === 'local' && resolvedStops.length > 0) {
      buildLocalRoute(resolvedHome || petLocation || walkerLocation, resolvedStops).then(({ outbound, back }) => {
        plannedOutboundRef.current = outbound;
        plannedBackRef.current = back;
        fillLocalRouteToDuration(outbound, back, walkDurationMinutes).then(({ wander }) => {
          const merged = wander.length > 1
            ? concatLegs(concatLegs(outbound, wander), back)
            : concatLegs(outbound, back);
          setRouteCoordinates(merged);
        });
        // Defer the actual visual rendering until the pickup code is
        // confirmed — see handleConfirmCode().
        if (!isComing) drawPlannedLocalLayers();
      });
    } else {
      const start = persistedTrailRef.current.length > 0 
        ? persistedTrailRef.current[persistedTrailRef.current.length - 1] 
        : (petLocation || walkerLocation);
      buildWalkLoop(start).then(setRouteCoordinates);
    }

    // Walker marker - photo if provided
    const wEl = document.createElement('div');
    wEl.innerHTML = `
      <div style="position:relative;width:48px;height:48px;">
        <div style="position:absolute;inset:-4px;border-radius:50%;background:hsl(159 100% 33% / 0.2);animation:ping 2s cubic-bezier(0,0,0.2,1) infinite;"></div>
        <div style="width:48px;height:48px;border-radius:50%;background:hsl(159,100%,33%);border:3px solid white;box-shadow:0 4px 15px rgba(49, 216, 128,0.4);overflow:hidden;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:18px;">
          ${walkerAvatar ? `<img src="${walkerAvatar}" style="width:100%;height:100%;object-fit:cover;" />` : walkerName.charAt(0).toUpperCase()}
        </div>
      </div>
    `;
    walkerMarkerRef.current = new mapboxgl.Marker(wEl).setLngLat(walkerLocation).addTo(map.current);

    // Pet marker
    const pEl = document.createElement('div');
    if (petAvatar) {
      pEl.innerHTML = `
        <div style="width:40px;height:40px;border-radius:50%;border:3px solid hsl(159,100%,33%);overflow:hidden;background:white;box-shadow:0 4px 15px rgba(49, 216, 128,0.3);">
          <img src="${petAvatar}" style="width:100%;height:100%;object-fit:cover;" />
        </div>
      `;
    } else {
      pEl.innerHTML = `
        <div style="width:40px;height:40px;border-radius:50%;border:3px solid hsl(159,100%,33%);background:white;box-shadow:0 4px 15px rgba(49, 216, 128,0.3);display:flex;align-items:center;justify-content:center;color:hsl(159,100%,33%);font-weight:800;font-size:14px;">
          ${petName.charAt(0).toUpperCase()}
        </div>
      `;
    }
    petMarkerRef.current = new mapboxgl.Marker(pEl).setLngLat(petLocation || walkerLocation).addTo(map.current);

    // The dog is rendered as a Three.js 3D custom Mapbox layer (added on map 'load' below).
    // Hide the two avatars when the walk starts so the 3D dog takes over.
    if (!isComing) {
      walkerMarkerRef.current?.getElement().style.setProperty('display','none');
      petMarkerRef.current?.getElement().style.setProperty('display','none');
    }

    // Add route trail source
    map.current.on('load', () => {
      if (!map.current) return;
      map.current.addSource('mapbox-dem', {
        'type': 'raster-dem',
        'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
        'tileSize': 512,
        'maxzoom': 14
      });
      map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.0 });
      if (!map.current) return;
      // Strip all street/place name labels for a clean look.
      hideMapLabels(map.current);
      tintMapInk(map.current, !!isDarkMode);
      // Enable terrain elevation so the custom Three.js dog layer can query
      // real altitude every frame and stay flush with sloped/3D map surfaces.
      if (!map.current.getSource('mapbox-dem')) {
        map.current.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.current.setTerrain({ source: 'mapbox-dem', exaggeration: 1 });
      // Translucent dashed line showing the walker's pending pickup route
      map.current.addSource('pickup-route', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pickupRoute && pickupRoute.length > 1 ? pickupRoute : [startCenter] } }
      });
      map.current.addLayer({
        id: 'pickup-route-line',
        type: 'line',
        source: 'pickup-route',
        paint: { 'line-color': '#31d880', 'line-width': 4, 'line-opacity': 0.45, 'line-dasharray': [1.5, 1.5] },
        layout: { 'line-join': 'round', 'line-cap': 'round' }
      });
      map.current.addSource('walk-trail', {
        type: 'geojson',
        lineMetrics: true,
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates:
              persistedTrailRef.current.length > 1
                ? persistedTrailRef.current
                : [startCenter],
          },
        },
      });
      // NOTE: no generic "upcoming-route" gray dashed line is rendered.
      //  - 'livre' has no predefined route.
      //  - 'local' shows the real planned legs (outbound + return) drawn by
      //    drawPlannedLocalLayers() in their own dedicated sources.
      map.current.addLayer({
        id: 'walk-trail-glow',
        type: 'line',
        source: 'walk-trail',
        paint: { 'line-color': '#31D880', 'line-width': 18, 'line-opacity': 0.22, 'line-blur': 10 },
        layout: { 'line-join': 'round', 'line-cap': 'round' }
      });
      map.current.addLayer({
        id: 'walk-trail-line',
        type: 'line',
        source: 'walk-trail',
        paint: {
          'line-width': 8,
          // Gradient along the line: oldest point ~10% opacity, current
          // position fully opaque. Requires lineMetrics on the source.
          'line-gradient': [
            'interpolate', ['linear'], ['line-progress'],
            0,    'rgba(0, 169, 120, 0.05)',
            0.35, 'rgba(0, 169, 120, 0.35)',
            0.75, 'rgba(49, 216, 128, 0.80)',
            1,    'rgba(49, 216, 128, 1.00)'
          ] as mapboxgl.Expression,
        },
        layout: { 'line-join': 'round', 'line-cap': 'round' }
      });
      // Multiple pets markers / 3D logic
      const start: [number, number] = lastLocRef.current || petLocation || walkerLocation;
      const ids = petIds && petIds.length > 0 ? petIds : [petId];
      
      // We are NOT removing the 3D dog models because they represent the pets themselves
      // and were requested to be "side-by-side" earlier.
      // We are ONLY removing the 3D environmental structures (buildings/trees) from the map.
      ids.forEach((id, idx) => {
        const layerId = `vp-dog-3d-${id}`;
        if (map.current?.getLayer(layerId)) return;
        const offset = ids.length > 1 ? (idx - (ids.length - 1) / 2) * 1.5 : 0;
        const layer = createDog3DLayer(layerId, start, { autoHeading: false, lateralOffsetMeters: offset });
        dog3dRefs.current[id] = layer;
        map.current?.addLayer(layer);
        
        const isDogVisible = !isComingRef.current || phaseRef.current === 'walking';
        layer.setVisible(isDogVisible);
        layer.setPosition(start);
        
        if (isDogVisible) {
          walkerMarkerRef.current?.getElement().style.setProperty('display', 'none');
          petMarkerRef.current?.getElement().style.setProperty('display', 'none');
        }
      });
      // Pré-cria a camada 3D do checkpoint (PIN GLB) já no carregamento do
      // mapa, escondida, exatamente como o DOG. Assim, ao iniciar o passeio,
      // basta `setPosition` + `setVisible(true)` — não precisamos esperar
      // `style.load`/`idle` e o pin aparece no mesmo instante do cachorro
      // (antes, ele só renderizava após uma troca de tema porque o addLayer
      // acontecia tarde demais no ciclo do Mapbox).
      const shouldShowCheckpoint = phaseRef.current !== 'pickup' && (checkpointPosRef.current || start);
      if (shouldShowCheckpoint && !map.current.getLayer('vp-checkpoint-3d')) {
        const cpPos = checkpointPosRef.current || start;
        const cp = createCheckpoint3DLayer('vp-checkpoint-3d', cpPos, {
          color: '#31D880',
          targetSizeMeters: 8,
          groundOffsetMeters: 0.25,
        });
        checkpointRef.current = cp;
        map.current.addLayer(cp);
        cp.setPosition(cpPos);
        cp.setVisible(true);
      }

      // Smoothly travel the camera from the pet location to the walker
      // when the pickup phase begins, so the transition from the search
      // screen feels continuous (no "flick").
      if (isComing && walkerLocation) {
        // Frame BOTH walker and pet so the user can see the full trajectory.
        const petLoc = petLocation || walkerLocation;
        const bounds = new mapboxgl.LngLatBounds().extend(walkerLocation).extend(petLoc);
        map.current.fitBounds(bounds, {
          padding: { top: 140, bottom: 220, left: 80, right: 80 },
          duration: 1800,
          pitch: 35,
          essential: true,
        });
      }
      // If we already have a planned local route (resolved before the map
      // finished loading), render the dashed legs + numbered stop pins —
      // but ONLY after the pickup code is confirmed. While the walker is
      // a caminho, the map stays clean.
      if (walkType === 'local' && phaseRef.current !== 'pickup') {
        if (plannedOutboundRef.current.length || plannedBackRef.current.length) {
          drawPlannedLocalLayers();
        }
        if (resolvedStops.length > 0) {
          drawStopPins();
        }
      }
      // Sinaliza que o mapa está pronto: o efeito do marcador reaplica
      // imediatamente a última coordenada conhecida (se houver), mesmo que
      // `livePosition` não mude de referência nesse instante.
      setMapReadyTick((n) => n + 1);
    });
    createdHere = true;

    // Detect manual user interaction — only user-initiated events have
    // an originalEvent (programmatic easeTo/flyTo don't). Once set, we
    // switch the pickup camera into "follow walker" mode.
    const markOverride = (e: unknown) => {
      if ((e as { originalEvent?: unknown })?.originalEvent) {
        lastUserInteractionRef.current = performance.now();
      }
    };
    map.current.on('dragstart', markOverride as never);
    map.current.on('zoomstart', markOverride as never);
    map.current.on('rotatestart', markOverride as never);
    map.current.on('pitchstart', markOverride as never);

    return () => {
      if (!createdHere) return;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      stopDashPulse();
      stopMarkersRef.current.forEach(mk => mk.remove());
      stopMarkersRef.current = [];
      map.current?.remove();
      map.current = null;
      // The live marker belongs to this map instance — drop the reference
      // so a future instance can recreate it instead of updating a marker
      // that is no longer in the DOM.
      if (liveAnimRef.current) cancelAnimationFrame(liveAnimRef.current);
      liveMarkerRef.current = null;
      setMapReadyTick((n) => n + 1);
    };
  // Intentionally exclude isDarkMode — the theme toggle swaps the style
  // in place (see effect below) WITHOUT remounting the map. Remounting
  // caused a visible flick, camera reframe and route re-animation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkerLocation, petLocation]);

  // ────────────────────────────────────────────────────────────────
  // Marcador da posição ATUAL do PetWalker (fonte canônica: RPC
  // `get_active_walker_location`, entregue pelo pai em `livePosition`).
  // É um marcador dedicado, sempre visível enquanto o passeio estiver
  // ativo, independente da animação/rastro. Nunca usa coordenada fictícia:
  // sem `livePosition` ele simplesmente não existe.
  // ────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Guarda SEMPRE a coordenada mais recente, mesmo sem mapa pronto.
    if (livePosition) {
      const prev = pendingLiveRef.current;
      if (!prev || livePosition.ts >= prev.ts) pendingLiveRef.current = livePosition;
    }
    const pending = pendingLiveRef.current;
    const m = map.current;
    if (!m || !pending) return;
    // Protege contra resposta fora de ordem: só avança no tempo. O marcador
    // pode não existir ainda (mapa recriado) — nesse caso reaplicamos.
    if (liveMarkerRef.current && liveLastRef.current && pending.ts < liveLastRef.current.ts) return;

    const from: [number, number] | null = liveMarkerRef.current && liveLastRef.current
      ? [liveLastRef.current.lng, liveLastRef.current.lat]
      : null;
    const to: [number, number] = [pending.lng, pending.lat];
    liveLastRef.current = pending;

    if (!liveMarkerRef.current) {
      const el = document.createElement('div');
      el.setAttribute('data-testid', 'active-walker-marker');
      el.style.width = '26px';
      el.style.height = '26px';
      el.innerHTML = `
        <div style="position:relative;width:26px;height:26px;">
          <div style="position:absolute;inset:-6px;border-radius:50%;background:hsl(159 100% 33% / 0.25);"></div>
          <div style="width:26px;height:26px;border-radius:50%;background:hsl(159,100%,33%);border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.25);"></div>
        </div>`;
      liveMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(to)
        .addTo(m);
      return;
    }

    // Transição suave entre a posição anterior e a nova.
    if (liveAnimRef.current) cancelAnimationFrame(liveAnimRef.current);
    if (!from) {
      liveMarkerRef.current.setLngLat(to);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / 600, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      liveMarkerRef.current?.setLngLat([
        from[0] + (to[0] - from[0]) * eased,
        from[1] + (to[1] - from[1]) * eased,
      ]);
      if (t < 1) liveAnimRef.current = requestAnimationFrame(step);
    };
    liveAnimRef.current = requestAnimationFrame(step);
  }, [livePosition, mapReadyTick]);

  // Limpeza: timer/animação e marcador saem juntos com o componente.
  useEffect(() => () => {
    if (liveAnimRef.current) cancelAnimationFrame(liveAnimRef.current);
    liveMarkerRef.current?.remove();
    liveMarkerRef.current = null;
  }, []);

  // Rastro histórico: re-hidrata `route_coordinates` (pontos realmente
  // persistidos pelo servidor) enquanto há posição ao vivo, mantendo o
  // formato [lng, lat] sem transformação.
  useEffect(() => {
    if (!sessionId || !livePosition) return;
    let active = true;
    const syncTrail = async () => {
      const { data } = await supabase
        .from('walk_sessions')
        .select('route_coordinates')
        .eq('id', sessionId)
        .maybeSingle();
      if (!active) return;
      const raw = (data?.route_coordinates as [number, number][] | null) || [];
      const clean = raw.filter(
        (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
      ) as [number, number][];
      if (clean.length <= persistedTrailRef.current.length) return;
      persistedTrailRef.current = clean;
      lastSavedTrailLenRef.current = clean.length;
      lastTrailAppendRef.current = clean[clean.length - 1] || null;
      const src = map.current?.getSource('walk-trail') as mapboxgl.GeoJSONSource | undefined;
      src?.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: clean },
      });
    };
    syncTrail();
    const id = setInterval(syncTrail, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, !!livePosition]);

  // Swap map style in place when the theme toggles. Preserve camera,
  // sources, layers and the 3D dog so nothing visually moves or replays.
  useEffect(() => {
    const m = map.current;
    if (!didSkipInitialThemeSyncRef.current) {
      didSkipInitialThemeSyncRef.current = true;
      return;
    }
    if (!m) return;
    // Snapshot current state we need to restore.
    let pickupData: GeoJSON.Feature | null = null;
    let trailData: GeoJSON.Feature | null = null;
    let upcomingData: GeoJSON.Feature | null = null;
    try {
      const ps = m.getSource('pickup-route') as mapboxgl.GeoJSONSource | undefined;
      // mapbox's GeoJSONSource exposes the data via internal _data; fall
      // back to the pickupRoute prop if not accessible.
      pickupData = (ps as unknown as { _data: GeoJSON.Feature })?._data ?? null;
      const ts = m.getSource('walk-trail') as mapboxgl.GeoJSONSource | undefined;
      trailData = (ts as unknown as { _data: GeoJSON.Feature })?._data ?? null;
      const us = m.getSource('upcoming-route') as mapboxgl.GeoJSONSource | undefined;
      upcomingData = (us as unknown as { _data: GeoJSON.Feature })?._data ?? null;
    } catch { /* ignorado */ }
    const dogPos = lastLocRef.current || currentPetLocation || petLocation || walkerLocation || null;
    const dogVisible = !isComing || phase === 'walking';

    m.setStyle(isDarkMode ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12');
    m.once('style.load', () => {
      if (!m) return;
      try {
        hideMapLabels(m);
        // Ensure the pastel palette is applied in light mode and ink in dark mode.
        tintMapInk(m, isDarkMode);
        
        if (!m.getSource('mapbox-dem')) {
          m.addSource('mapbox-dem', {
            type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14,
          } as mapboxgl.RasterDEMSourceSpecification);
        }
        m.setTerrain({ source: 'mapbox-dem', exaggeration: 1 });

        // Re-add pickup route
        if (!m.getSource('pickup-route')) {
          m.addSource('pickup-route', {
            type: 'geojson',
            data: pickupData ?? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pickupRoute && pickupRoute.length > 1 ? pickupRoute : [] } },
          } as mapboxgl.GeoJSONSourceSpecification);
          m.addLayer({
            id: 'pickup-route-line', type: 'line', source: 'pickup-route',
            paint: { 'line-color': '#31d880', 'line-width': 4, 'line-opacity': 0.45, 'line-dasharray': [1.5, 1.5] },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          });
        }
        // Re-add walk trail
        if (!m.getSource('walk-trail')) {
          m.addSource('walk-trail', {
            type: 'geojson',
            lineMetrics: true,
            data:
              trailData ?? {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: persistedTrailRef.current.length ? persistedTrailRef.current : [],
                },
              },
          } as mapboxgl.GeoJSONSourceSpecification);
          m.addLayer({
            id: 'walk-trail-glow', type: 'line', source: 'walk-trail',
            paint: { 'line-color': '#31D880', 'line-width': 18, 'line-opacity': 0.22, 'line-blur': 10 },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          });
          m.addLayer({
            id: 'walk-trail-line', type: 'line', source: 'walk-trail',
            paint: {
              'line-width': 8,
              'line-gradient': [
                'interpolate', ['linear'], ['line-progress'],
                0,    'rgba(0, 169, 120, 0.05)',
                0.35, 'rgba(0, 169, 120, 0.35)',
                0.75, 'rgba(49, 216, 128, 0.80)',
                1,    'rgba(49, 216, 128, 1.00)'
              ] as mapboxgl.Expression,
            },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          });
        }
        // Re-add planned local LEGS after a style swap (GL layers don't
        // survive setStyle). Stop pins are DOM markers and DO survive — no
        // need to redraw them, which would also briefly flicker. Skip
        // entirely during the pickup phase — the map must stay clean while
        // the walker is on the way.
        if (walkType === 'local' && phaseRef.current !== 'pickup') {
          drawPlannedLocalLayers();
        }
        // Re-add the 3D dog layers at their last positions
        const ids = petIds && petIds.length > 0 ? petIds : [petId];
        ids.forEach((id, idx) => {
          const layerId = `vp-dog-3d-${id}`;
          if (!m.getLayer(layerId)) {
            const start: [number, number] = dogPos || [0, 0];
            const offset = ids.length > 1 ? (idx - (ids.length - 1) / 2) * 1.5 : 0;
            const layer = createDog3DLayer(layerId, start, { autoHeading: false, lateralOffsetMeters: offset });
            dog3dRefs.current[id] = layer;
            m.addLayer(layer);
            layer.setVisible(dogVisible);
            layer.setPosition(start);
          } else {
            dog3dRefs.current[id]?.setVisible(dogVisible);
            if (dogPos) dog3dRefs.current[id]?.setPosition(dogPos);
          }
        });
        // Re-add the 3D start checkpoint pin after a style swap.
        if (checkpointPosRef.current && !m.getLayer('vp-checkpoint-3d')) {
          const cp = createCheckpoint3DLayer('vp-checkpoint-3d', checkpointPosRef.current, { color: '#31D880' });
          checkpointRef.current = cp;
          m.addLayer(cp);
          cp.setPosition(checkpointPosRef.current);
        }
        if (checkpointPosRef.current) drawHomeCheckpoint(checkpointPosRef.current);
        if (isReturning && returnRouteRef.current.length >= 2) drawReturnRoute(returnRouteRef.current);
      } catch { /* ignorado */ }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDarkMode]);

  // Keep the 3D dog visibility in sync with the current phase. The layer is
  // created once on map load (with the initial `isComing` value); when the
  // pickup completes and we transition into the walking phase the layer
  // would otherwise stay hidden until the style is swapped.
  useEffect(() => {
    const ids = petIds && petIds.length > 0 ? petIds : [petId];
    const isVisible = !isComing || phase === 'walking';
    ids.forEach(id => {
      const layer = dog3dRefs.current[id];
      if (layer) {
        layer.setVisible(isVisible);
        if (isVisible) layer.setPosition(lastLocRef.current || petLocation || walkerLocation);
      }
    });
    if (isVisible) {
      walkerMarkerRef.current?.getElement().style.setProperty('display', 'none');
      petMarkerRef.current?.getElement().style.setProperty('display', 'none');
    }
  }, [isComing, phase, petLocation, walkerLocation, petIds, petId]);

  // Safety net: whenever we leave the pickup phase (code confirmed or
  // walker arrived), make sure the planned IDA/VOLTA dashed route and the
  // numbered stop pins are on the map for LOCAL walks. Covers races where
  // `drawPlannedLocalLayers()` inside `handleConfirmCode().then(...)` ran
  // before the style was fully loaded, or the dev "Skip" button was used.
  useEffect(() => {
    if (walkType !== 'local') return;
    if (phase === 'pickup') return;
    if (isReturning) return;
    const home = lastLocRef.current || resolvedHome || petLocation || walkerLocation;
    if (!home || resolvedStops.length === 0) return;
    let cancelled = false;
    (async () => {
      if (
        plannedOutboundRef.current.length === 0 ||
        plannedBackRef.current.length === 0
      ) {
        const { outbound, back } = await buildLocalRoute(home, resolvedStops);
        if (cancelled) return;
        plannedOutboundRef.current = outbound;
        plannedBackRef.current = back;
        if (phaseRef.current === 'walking') {
          setRouteCoordinates((cur) => (cur.length ? cur : concatLegs(outbound, back)));
        }
      }
      drawPlannedLocalLayers();
      drawStopPins();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, walkType, resolvedStops, resolvedHome, isReturning]);

  // Watchdog: while walking a LOCAL route, make sure the planned dashed
  // layers are always on the map. Mapbox can drop GL layers on style
  // changes, source eviction, or rare re-renders; we re-attach on every
  // map `idle` and `styledata` event. Cheap because `ensureLeg` is a
  // no-op when the source already exists.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (walkType !== 'local') return;
    if (phase === 'pickup') return;
    if (isReturning) return;
    const ensure = () => {
      if (!map.current) return;
      if (!map.current.isStyleLoaded()) return;
      const hasOutbound = !!map.current.getLayer('planned-outbound-dash');
      const hasBack = !!map.current.getLayer('planned-back-dash');
      if (!hasOutbound || !hasBack) {
        drawPlannedLocalLayers();
      }
        if (phaseRef.current === 'walking') {
          const dogPos = lastLocRef.current || currentPetLocation || petLocation || walkerLocation;
          if (dogPos) {
            const ids = petIds && petIds.length > 0 ? petIds : [petId];
            ids.forEach((id, idx) => {
              const layerId = `vp-dog-3d-${id}`;
              if (!map.current?.getLayer(layerId)) {
                const offset = ids.length > 1 ? (idx - (ids.length - 1) / 2) * 1.5 : 0;
                const layer = createDog3DLayer(layerId, dogPos, { autoHeading: false, lateralOffsetMeters: offset });
                dog3dRefs.current[id] = layer;
                map.current?.addLayer(layer);
                layer.setVisible(true);
                layer.setPosition(dogPos);
              } else {
                dog3dRefs.current[id]?.setVisible(true);
              }
            });
          }
          if (checkpointPosRef.current && !map.current.getLayer('vp-checkpoint-3d')) {
            const cp = createCheckpoint3DLayer('vp-checkpoint-3d', checkpointPosRef.current, { color: '#31D880' });
            checkpointRef.current = cp;
            map.current.addLayer(cp);
            cp.setPosition(checkpointPosRef.current);
          }
          if (resolvedStops.length > 0 && stopMarkersRef.current.length !== resolvedStops.length) {
            drawStopPins();
          }
        }
      // Keep the directional dash animation alive too.
      if (
        (map.current.getLayer('planned-outbound-dash') ||
          map.current.getLayer('planned-back-dash')) &&
        dashAnimRef.current == null
      ) {
        startDashPulse();
      }
    };
    m.on('idle', ensure);
    m.on('styledata', ensure);
    // Run once now in case we already missed an idle.
    ensure();
    return () => {
      m.off('idle', ensure);
      m.off('styledata', ensure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, walkType, isReturning]);

  // ---------------------------------------------------------------------
  // RETURN MODE: when the user authorizes the return via chat we need to
  //   1. clear the previously-drawn planned legs / numbered pins
  //   2. wipe the existing walk trail so the line doesn't keep its old shape
  //   3. build a fresh real walking route from the dog's CURRENT position
  //      back to home, and feed it to the animation loop as the new route.
  // Without this the 3D dog used to freeze in place and the original
  // dashed/back legs stayed on screen.
  // ---------------------------------------------------------------------
  const returnAppliedRef = useRef(false);
  useEffect(() => {
    if (!isReturning) { returnAppliedRef.current = false; return; }
    if (returnAppliedRef.current) return;
    if (phase !== 'walking') return;
    const home = resolvedHome || petLocation || walkerLocation;
    const from = lastLocRef.current || currentPetLocation || home;
    if (!home || !from) return;
    returnAppliedRef.current = true;
    (async () => {
      // Remove the original outbound/back planned layers + numbered pins so
      // the map only shows the new return path.
      clearPlannedLocalLayers();
      drawHomeCheckpoint(home);
      // IMPORTANT: do NOT wipe the walk-trail here. The breadcrumb must
      // accumulate across outbound + return so the user can see every
      // step the pet took during the whole walk.
      let path = await fetchWalkingRouteMulti([from, home]);
      if (path.length < 2) path = [from, home];
      returnRouteRef.current = path;
      drawReturnRoute(path);
      const meters = path.slice(1).reduce((sum, p, idx) => sum + haversine(path[idx], p), 0);
      setRemainingMeters(Math.round(meters / 10) * 10);
      setEtaSec(Math.max(1, Math.round(meters / 1.1)));
      // Cancel any in-flight animation frame from the previous route so the
      // new route's animation starts cleanly.
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      setRouteCoordinates(path);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReturning, phase, resolvedHome, petLocation, walkerLocation, currentPetLocation]);

  useEffect(() => {
    const m = map.current;
    if (!m || !isReturning) return;
    const ensureReturnVisuals = () => {
      const home = resolvedHome || petLocation || walkerLocation;
      if (home) drawHomeCheckpoint(home);
      if (returnRouteRef.current.length >= 2) drawReturnRoute(returnRouteRef.current);
    };
    m.on('idle', ensureReturnVisuals);
    m.on('styledata', ensureReturnVisuals);
    ensureReturnVisuals();
    return () => {
      m.off('idle', ensureReturnVisuals);
      m.off('styledata', ensureReturnVisuals);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReturning, resolvedHome, petLocation, walkerLocation]);

  // Smooth Uber-style animation: interpolate between waypoints with requestAnimationFrame
  useEffect(() => {
    if (!routeCoordinates.length || phase === 'arrived') return;
    // Prepend last known marker position to new route to prevent visible teleports
    const baseRoute = routeCoordinates;
    const startFrom = lastLocRef.current || (persistedTrailRef.current.length > 0 ? persistedTrailRef.current[persistedTrailRef.current.length - 1] : null);
    const route: [number, number][] =
      startFrom && haversine(startFrom, baseRoute[0]) > 1
        ? [startFrom, ...baseRoute]
        : baseRoute;
    // Where the planned outbound leg ends within `route`. This lets the
    // tick loop trim the dashed planned route as the dog walks forward —
    // the planned line "consumes" itself, leaving only the real trail
    // behind the pet.
    const prependedOffset = route.length > baseRoute.length ? 1 : 0;
    const obLen = plannedOutboundRef.current.length;
    const outboundEndIdx = obLen > 0 ? prependedOffset + obLen - 1 : -1;
    let lastPlannedUpdate = 0;

    // Precompute cumulative distances along the polyline (in meters, constant speed)
    const seg: number[] = [0];
    for (let i = 1; i < route.length; i++) {
      seg.push(seg[i - 1] + haversine(route[i - 1], route[i]));
    }
    const totalDist = seg[seg.length - 1] || 1;
    // Base speed (m/s):
    //  - pickup → transport speed (driver/biker/walker on the way)
    //  - walking → ~1.1 m/s, MAS escalada para preencher a duração planejada
    //    do passeio. Sem isso, rotas curtas (ex.: 600m de ida+volta) terminam
    //    em ~9min num passeio de 30min — o cachorro chegava em casa e ficava
    //    parado, o que o usuário interpretava como "voltou tudo". Agora a
    //    simulação respeita o tempo escolhido: o pet anda devagar quando a
    //    rota é curta e mais rápido quando a rota é longa.
    let baseSpeed = phase === 'pickup' ? pickupSpeedMs : 1.1;
    if (phase !== 'pickup' && !isReturning && walkDurationMinutes > 0) {
      // Reserva 1min do final para o usuário/PetWalker confirmar o retorno
      // sem que o cachorro fique parado em casa.
      const targetSec = Math.max(60, walkDurationMinutes * 60 - 60);
      const desired = totalDist / targetSec;
      // Mínimo de 0.35 m/s (1.26 km/h, ritmo bem lento mas ainda visível).
      // Máximo: a velocidade padrão (1.1 m/s) — nunca acelera além disso.
      baseSpeed = Math.min(baseSpeed, Math.max(0.35, desired));
    }

    // Realistic per-segment speed: on long straight stretches a motorcycle/car
    // accelerates well above the average; at sharp corners it slows down.
    // We grade each segment by:
    //   1. Turn angle at its end vertex (sharper = slower)
    //   2. Segment length (longer = more room to reach top speed)
    // Pedestrian/bike modes get a smaller dynamic range so motion stays calm.
    const isVehicle = phase === 'pickup' && (transport?.mode === 'moto' || transport?.mode === 'car');
    const maxMult = isVehicle ? (transport?.mode === 'moto' ? 2.0 : 1.8) : 1.15;
    const minMult = isVehicle ? 0.35 : 0.7;

    const turnAngleAt = (idx: number): number => {
      // Angle (rad) between incoming and outgoing segment at vertex idx.
      const prev = route[idx - 1];
      const cur = route[idx];
      const next = route[idx + 1];
      if (!prev || !next) return 0;
      const ax = cur[0] - prev[0], ay = cur[1] - prev[1];
      const bx = next[0] - cur[0], by = next[1] - cur[1];
      const am = Math.hypot(ax, ay), bm = Math.hypot(bx, by);
      if (am < 1e-9 || bm < 1e-9) return 0;
      const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (am * bm)));
      return Math.acos(cos); // 0 = straight, PI = U-turn
    };

    // Compute time per segment using a target speed that ramps with straightness
    // and segment length, then smooth it so the speed doesn't jump abruptly
    // between neighbouring segments (gives a natural accel/brake feel).
    const rawMult: number[] = [1];
    for (let i = 1; i < route.length; i++) {
      // Use the SHARPER of the entry & exit corners of this segment.
      const angIn = turnAngleAt(i - 1);
      const angOut = turnAngleAt(i);
      const ang = Math.max(angIn, angOut);
      // turnFactor: 1 when perfectly straight, ~0 at ~60°+ turn
      const turnFactor = Math.max(0, 1 - ang / (Math.PI / 3));
      // lengthFactor: 0 for tiny segments, 1 for 80m+ (enough to gain speed)
      const segLen = seg[i] - seg[i - 1];
      const lengthFactor = Math.min(1, segLen / 80);
      const straightness = turnFactor * lengthFactor;
      rawMult.push(minMult + (maxMult - minMult) * straightness);
    }
    // Smooth with a 3-tap window so acceleration/braking is gradual.
    const segMult: number[] = rawMult.map((_, i) => {
      if (i === 0) return rawMult[0];
      const a = rawMult[i - 1] ?? rawMult[i];
      const b = rawMult[i];
      const c = rawMult[i + 1] ?? rawMult[i];
      return a * 0.25 + b * 0.5 + c * 0.25;
    });

    // Per-segment durations (ms) and cumulative timeline.
    const segTime: number[] = [0];
    for (let i = 1; i < route.length; i++) {
      const segLen = seg[i] - seg[i - 1];
      const v = baseSpeed * segMult[i];
      segTime.push(segTime[i - 1] + (segLen / Math.max(0.1, v)) * 1000);
    }
    const totalMs = Math.max(phase === 'pickup' ? 3500 : 8000, segTime[segTime.length - 1] || 1);
    // Average effective speed for ETA reporting (m/s).
    const speed = totalDist / (totalMs / 1000);

    let lastStateUpdate = 0;
    let lastCamUpdate = 0;
    let lastCamCenter: [number, number] | null = null;
    let lastEtaUpdate = 0;
    let smoothEta = -1;    // EMA-smoothed ETA (seconds)
    let smoothRem = -1;    // EMA-smoothed remaining distance (meters)
    let lastShownEta = -1;
    let lastShownRem = -1;
    const initialElapsed = (walkStartedAt && phase === 'walking') 
      ? Math.max(0, Date.now() - walkStartedAt.getTime()) 
      : 0;
    const startTs = performance.now() - initialElapsed;

    const tick = (t: number) => {
      const elapsed = Math.min(totalMs, t - startTs);
      // Find the active segment by elapsed time on the variable-speed timeline.
      let i = 1;
      while (i < segTime.length && segTime[i] < elapsed) i++;
      const a = route[i - 1];
      const b = route[i] || a;
      const segDur = (segTime[i] ?? segTime[i - 1]) - segTime[i - 1] || 1;
      const sp = Math.min(1, Math.max(0, (elapsed - segTime[i - 1]) / segDur));
      const loc: [number, number] = [a[0] + (b[0] - a[0]) * sp, a[1] + (b[1] - a[1]) * sp];
      // Distance covered so far (for ETA/remaining display).
      const segLen = (seg[i] ?? seg[i - 1]) - seg[i - 1] || 1;
      const d = (seg[i - 1] ?? 0) + segLen * sp;
      const p = elapsed / totalMs;
      lastLocRef.current = loc;

      if (phase === 'pickup') {
        walkerMarkerRef.current?.setLngLat(loc);
        const remaining = Math.max(0, totalDist - d);
        const rawEta = remaining / speed;
        // Exponential moving average for smoothness (alpha low = smoother, slower)
        const alpha = 0.12;
        smoothEta = smoothEta < 0 ? rawEta : smoothEta + alpha * (rawEta - smoothEta);
        smoothRem = smoothRem < 0 ? remaining : smoothRem + alpha * (remaining - smoothRem);
        // Monotonic: never increase displayed ETA/distance (avoid jumps when oscillating)
        if (lastShownEta >= 0) smoothEta = Math.min(smoothEta, lastShownEta + 0.3);
        if (lastShownRem >= 0) smoothRem = Math.min(smoothRem, lastShownRem + 5);
        // Throttle UI updates to ~2x/sec
        if (t - lastEtaUpdate > 500) {
          lastEtaUpdate = t;
          const etaShown = Math.max(0, Math.round(smoothEta));
          const remShown = Math.max(0, Math.round(smoothRem / 10) * 10);
          if (etaShown !== lastShownEta) { lastShownEta = etaShown; setEtaSec(etaShown); }
          if (remShown !== lastShownRem) { lastShownRem = remShown; setRemainingMeters(remShown); }
        }
        // Update translucent pickup polyline: from current loc to end
        if (map.current?.getSource('pickup-route')) {
          const coords: [number, number][] = [loc, ...route.slice(i)];
          (map.current.getSource('pickup-route') as mapboxgl.GeoJSONSource).setData({
            type: 'Feature', properties: {},
            geometry: { type: 'LineString', coordinates: coords }
          });
        }
      } else {
        const ids = petIds && petIds.length > 0 ? petIds : [petId];
        const anyDogActive = ids.some(id => !!dog3dRefs.current[id]);
        const activeDogLoc = anyDogActive ? loc : null;
        
        ids.forEach((id, idx) => {
          const layerId = `vp-dog-3d-${id}`;
          if (!dog3dRefs.current[id] && map.current && map.current.isStyleLoaded() && !map.current.getLayer(layerId)) {
            const offset = ids.length > 1 ? (idx - (ids.length - 1) / 2) * 1.5 : 0;
            const layer = createDog3DLayer(layerId, loc, { autoHeading: false, lateralOffsetMeters: offset });
            dog3dRefs.current[id] = layer;
            map.current.addLayer(layer);
            layer.setVisible(true);
            layer.setPosition(loc);
          }
        });
        // Hide pickup route during walking phase
        if (map.current?.getSource('pickup-route')) {
          (map.current.getSource('pickup-route') as mapboxgl.GeoJSONSource).setData({
            type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] }
          });
        }
        // Hide the two avatars during the walk — use a single interactive 3D-style dog
        const wEl2 = walkerMarkerRef.current?.getElement();
        const pEl2 = petMarkerRef.current?.getElement();
        if (wEl2 && wEl2.style.display !== 'none') wEl2.style.display = 'none';
        if (pEl2 && pEl2.style.display !== 'none') pEl2.style.display = 'none';
        // Drive the Three.js 3D dog
        Object.values(dog3dRefs.current).forEach(layer => {
          layer.setVisible(true);
          layer.setPosition(loc);
        });
        // Bearing from the actual path geometry — independent of frame deltas.
        // We blend the CURRENT segment direction (a→b) with the NEXT segment
        // direction (b→route[i+1]), starting the turn slightly before the
        // vertex so the dog rotates into the curve like a real walker.
        // Both vectors are NORMALIZED first so segment length differences
        // don't bias the blend (sharp short turns stay aligned).
        // IMPORTANT: bearing must be computed in METERS (east/north), not in
        // raw lng/lat differences. At our latitudes 1° of longitude is ~30%
        // shorter than 1° of latitude, so atan2(dLng, dLat) gave a skewed
        // heading and the dog looked "torto" / "girando" relative to the
        // street it was walking on. Convert each delta to meters first.
        const latCos = Math.cos((b[1] * Math.PI) / 180);
        const toMeters = (p1: [number, number], p2: [number, number]): [number, number] => {
          const dx = (p2[0] - p1[0]) * 111320 * latCos;   // east (m)
          const dy = (p2[1] - p1[1]) * 110540;             // north (m)
          return [dx, dy];
        };
        const norm = (vx: number, vy: number): [number, number] => {
          const m = Math.hypot(vx, vy);
          return m > 1e-9 ? [vx / m, vy / m] : [0, 0];
        };
        const abM = toMeters(a, b);
        const [cdx, cdy] = norm(abM[0], abM[1]);
        const next = route[i + 1];
        const bnM = next ? toMeters(b, next) : abM;
        const [ndx, ndy] = next ? norm(bnM[0], bnM[1]) : [cdx, cdy];
        // Start the look-ahead blend very close to the vertex so the dog
        // stays aligned with the current street and only rotates AT the
        // corner — instead of looking "torto" / diagonal half a block
        // before reaching it.
        const turnStart = 0.94;
        const t = sp <= turnStart ? 0 : (sp - turnStart) / (1 - turnStart);
        const ease = t * t * (3 - 2 * t); // smoothstep
        const dx = cdx * (1 - ease) + ndx * ease;
        const dy = cdy * (1 - ease) + ndy * ease;
        if (dx * dx + dy * dy > 1e-10) {
          const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
          pathBearingRef.current = bearing;
          Object.values(dog3dRefs.current).forEach(layer => layer.setBearing(bearing));
        }
        if (!activeDogLoc) Object.values(dog3dRefs.current).forEach(layer => layer.setPosition(loc));
        // Update trail incrementally (route up to current i + current loc)
        if (map.current?.getSource('walk-trail')) {
          // Append the live position to the PERSISTED breadcrumb so the
          // trail never resets when the route changes (return mode,
          // local-walk re-plan, theme swap, screen remount). The full
          // history is kept in persistedTrailRef and mirrored to the DB.
          const coords = appendTrailPoint(loc);
          (map.current.getSource('walk-trail') as mapboxgl.GeoJSONSource).setData({
            type: 'Feature', properties: {},
            geometry: { type: 'LineString', coordinates: coords }
          });
        }
        // Trim the planned (dashed) route so it starts at the dog's
        // current position — as the pet walks, the planned line ahead
        // shrinks and the breadcrumb behind grows. Throttled to ~5fps.
        if (walkType === 'local' && !isReturning && map.current && t - lastPlannedUpdate > 200) {
          lastPlannedUpdate = t;
          const obSrc = map.current.getSource('planned-outbound') as mapboxgl.GeoJSONSource | undefined;
          const bkSrc = map.current.getSource('planned-back') as mapboxgl.GeoJSONSource | undefined;
          if (outboundEndIdx >= 0 && i <= outboundEndIdx) {
            // Still on outbound leg.
            const obIdx = Math.max(0, i - prependedOffset);
            const remainingOb: [number, number][] = [loc, ...plannedOutboundRef.current.slice(obIdx + 1)];
            if (obSrc && remainingOb.length >= 2) {
              obSrc.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: remainingOb } });
            }
            // Back leg stays as-is until the dog reaches it.
          } else if (plannedBackRef.current.length >= 2) {
            // Past outbound — clear it, trim back.
            if (obSrc) obSrc.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } });
            const bkIdx = Math.max(0, i - outboundEndIdx);
            const remainingBk: [number, number][] = [loc, ...plannedBackRef.current.slice(bkIdx + 1)];
            if (bkSrc && remainingBk.length >= 2) {
              bkSrc.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: remainingBk } });
            }
          }
        }
        if (isReturning && map.current?.getSource('return-route')) {
          const aheadCoords: [number, number][] = [loc, ...route.slice(i)];
          const safeAhead = aheadCoords.length >= 2 ? aheadCoords : [loc, loc];
          returnRouteRef.current = safeAhead;
          (map.current.getSource('return-route') as mapboxgl.GeoJSONSource).setData({
            type: 'Feature', properties: {},
            geometry: { type: 'LineString', coordinates: safeAhead }
          });
          const remaining = Math.max(0, totalDist - d);
          const rawEta = remaining / speed;
          if (t - lastEtaUpdate > 500) {
            lastEtaUpdate = t;
            const etaShown = Math.max(0, Math.round(rawEta));
            const remShown = Math.max(0, Math.round(remaining / 10) * 10);
            if (etaShown !== lastShownEta) { lastShownEta = etaShown; setEtaSec(etaShown); }
            if (remShown !== lastShownRem) { lastShownRem = remShown; setRemainingMeters(remShown); }
          }
        }
        // Update upcoming dashed route (from current loc to the end)
        if (map.current?.getSource('upcoming-route')) {
          const aheadCoords: [number, number][] = [loc, ...route.slice(i)];
          (map.current.getSource('upcoming-route') as mapboxgl.GeoJSONSource).setData({
            type: 'Feature', properties: {},
            geometry: { type: 'LineString', coordinates: aheadCoords }
          });
        }
      }
      // Smooth camera follow — easeTo throttled to avoid jitter.
      // Pickup uses a SLOW cadence (2s) + long ease so the framing of
      // walker+pet stays calm. During the walking phase we use a 1.1s
      // cadence with a 1s ease so the next easeTo never interrupts the
      // previous one (which used to cause the visible "piscar" and the
      // camera snapping back to a slightly different bearing each tick).
      const isCoarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
      const camInterval = isCoarsePointer ? (phase === 'pickup' ? 4200 : 3200) : (phase === 'pickup' ? 2400 : 1600);
      if (map.current && t - lastCamUpdate > camInterval) {
        const idleEnough = performance.now() - lastUserInteractionRef.current > AUTO_FOLLOW_IDLE_MS;
        // Never start a new camera animation while Mapbox is still settling
        // the previous one. On mobile GPUs, overlapping easeTo/fitBounds calls
        // look like the map is blinking/jumping every GPS tick.
        const cameraAvailable = !map.current.isMoving();
        if (phase === 'pickup' && idleEnough && cameraAvailable) {
          // Skip if walker barely moved since the last fit (avoids tiny
          // re-frames that visually shake the map without adding info).
          const moved = lastCamCenter ? haversine(lastCamCenter, loc) : Infinity;
          if (moved > 20) {
            lastCamUpdate = t;
            lastCamCenter = loc;
            const petLoc = petLocation || loc;
            const bounds = new mapboxgl.LngLatBounds().extend(loc).extend(petLoc);
            map.current.fitBounds(bounds, {
              padding: { top: 140, bottom: 220, left: 80, right: 80 },
              duration: isCoarsePointer ? 2200 : 1600,
              essential: true,
              maxZoom: 17,
              easing: (x) => 1 - Math.pow(1 - x, 3),
            } as mapboxgl.FitBoundsOptions);
          }
        } else if (phase !== 'pickup' && idleEnough && cameraAvailable) {
          // Skip if the dog barely moved and the path bearing didn't change
          // meaningfully — re-applying the same easeTo each tick was the
          // root cause of the visible camera "reset" the user reported.
          const moved = lastCamCenter ? haversine(lastCamCenter, loc) : Infinity;
          const currentBearing = map.current.getBearing();
          const targetBearing = pathBearingRef.current - 35;
          const bearingDelta = Math.abs(((targetBearing - currentBearing + 540) % 360) - 180);
          const needsCenter = moved > (isCoarsePointer ? 18 : 8);
          const needsBearing = bearingDelta > (isCoarsePointer ? 28 : 16);
          if (needsCenter || needsBearing) {
            lastCamUpdate = t;
            lastCamCenter = loc;
            // Only pass bearing when it actually needs to change so small
            // path wobbles don't keep spinning the camera every tick.
            const opts: Parameters<mapboxgl.Map['easeTo']>[0] = {
              center: loc,
              zoom: 19.1,
              pitch: 66,
              duration: isCoarsePointer ? 1800 : 1200,
              essential: true,
              easing: (x) => 1 - Math.pow(1 - x, 3),
            };
            if (needsBearing) (opts as { bearing?: number }).bearing = targetBearing;
            map.current.easeTo(opts);
          }
        }
      }

      // Throttle React state updates to ~once per 2s (DB save trigger)
      if (phase === 'walking' && t - lastStateUpdate > 2000) {
        lastStateUpdate = t;
        setCurrentPetLocation(loc);
      }

      if (p < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        const endLoc = route[route.length - 1];
        if (phase === 'pickup') {
          // Walker has arrived at the pet — pause for code confirmation
          setEtaSec(0);
          setPhase('arrived');
        } else if (isReturning) {
          // Reached home on the return leg — stay put and wait for the
          // user to tap "Confirmar chegada".
          setEtaSec(0);
          setRemainingMeters(0);
          returnRouteRef.current = [endLoc, endLoc];
          if (map.current?.getSource('return-route')) {
            (map.current.getSource('return-route') as mapboxgl.GeoJSONSource).setData({
              type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [endLoc, endLoc] },
            });
          }
        } else {
          // LIVRE mode keeps exploring; LOCAL mode stays put at home
          // after completing the planned outbound + return — otherwise
          // the dog would start a random exploration loop and look like
          // it's "indo e voltando" randomly after finishing the plan.
          if (walkType === 'local') {
            lastLocRef.current = endLoc;
            setEtaSec(0);
            setRemainingMeters(0);
            Object.values(dog3dRefs.current).forEach(layer => layer.setPosition(endLoc));
          } else {
            buildWalkLoop(endLoc).then(loop => setRouteCoordinates(loop));
          }
        }
      }
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [routeCoordinates, isReturning, phase, pickupSpeedMs]);


  const handleConfirmCode = async () => {
    if (codeInput.length !== 6) {
      setCodeError(true);
      setTimeout(() => setCodeError(false), 800);
      return;
    }

    try {
      setConcluding(true);
      const { data: success, error } = await supabase.rpc('petwalker_confirm_pickup', {
        walk_id: sessionId,
        input_pin: codeInput
      });

      if (error || !success) {
        setCodeError(true);
        setTimeout(() => setCodeError(false), 800);
        setConcluding(false);
        return;
      }

      // Success! Transition state
      setPhase('walking');
      setConcluding(false);
    } catch (e) {
      console.error('PIN validation error:', e);
      setCodeError(true);
      setConcluding(false);
      return;
    }

    const start = lastLocRef.current || petLocation || walkerLocation;
    if (!start) return;
    setWalkStartedAt(new Date());
    lastLocRef.current = start;
    checkpointPosRef.current = start;
    // Add the 3D dog + checkpoint and the planned route AS SOON AS the
    // map is ready. If the style isn't fully loaded yet (or a theme swap
    // is in flight), retry on `style.load`/`idle` instead of silently
    // skipping — that was why occasionally nothing rendered after the
    // PIN was confirmed.
    const whenReady = (fn: () => void) => {
      const m = map.current;
      if (!m) return;
      if (m.isStyleLoaded()) { fn(); return; }
      let done = false;
      const run = () => { if (done) return; done = true; try { fn(); } catch { /* ignorado */ } };
      m.once('style.load', run);
      m.once('idle', run);
      // Hard fallback: if neither event fires within 1.2s (rare race during
      // theme swaps), retry on a timer until the style is ready.
      const poll = setInterval(() => {
        if (done || !map.current) { clearInterval(poll); return; }
        if (map.current.isStyleLoaded()) { clearInterval(poll); run(); }
      }, 200);
      setTimeout(() => clearInterval(poll), 8000);
    };
    whenReady(() => {
      const m = map.current;
      if (!m) return;
      const ids = petIds && petIds.length > 0 ? petIds : [petId];
      ids.forEach((id, idx) => {
        const layerId = `vp-dog-3d-${id}`;
        if (!m.getLayer(layerId)) {
          const offset = ids.length > 1 ? (idx - (ids.length - 1) / 2) * 1.5 : 0;
          const layer = createDog3DLayer(layerId, start, { autoHeading: false, lateralOffsetMeters: offset });
          dog3dRefs.current[id] = layer;
          m.addLayer(layer);
        }
        dog3dRefs.current[id]?.setPosition(start);
        dog3dRefs.current[id]?.setVisible(true);
      });
      // Use o mesmo caminho que a recuperação de troca de tema
      // (drawHomeCheckpoint) — opções idênticas, listeners de
      // style.load/idle e triggerRepaint garantem que o pin
      // apareça já no primeiro frame, sem precisar trocar tema.
      drawHomeCheckpoint(start);
      // Force a repaint so the custom WebGL layer renders its first frame
      // immediately — otherwise Mapbox sometimes waits for the next style
      // event (which is why the pin only appeared after toggling theme).
      try { m.triggerRepaint(); } catch { /* ignorado */ }
      try { m.moveLayer('vp-checkpoint-3d'); } catch { /* ignorado */ }
    });
    walkerMarkerRef.current?.getElement().style.setProperty('display', 'none');
    petMarkerRef.current?.getElement().style.setProperty('display', 'none');
    // Aggressive retry: ensure the 3D checkpoint pin actually appears on
    // the map, even across style swaps / rare GL races, for the entire
    // walking phase. Re-checks every 600ms for up to 12s.
    let cpAttempts = 0;
    const cpPoll = setInterval(() => {
      cpAttempts++;
      const m = map.current;
      const pos = checkpointPosRef.current || start;
      if (!m || !pos || cpAttempts > 20) { clearInterval(cpPoll); return; }
      if (!m.isStyleLoaded()) return;
      if (m.getLayer('vp-checkpoint-3d')) { clearInterval(cpPoll); return; }
      try {
        const cp = createCheckpoint3DLayer('vp-checkpoint-3d', pos, { color: '#31D880', targetSizeMeters: 8, groundOffsetMeters: 0.25 });
        checkpointRef.current = cp;
        m.addLayer(cp);
        cp.setPosition(pos);
        cp.setVisible(true);
        try { m.moveLayer('vp-checkpoint-3d'); } catch { /* ignorado */ }
        try { m.triggerRepaint(); } catch { /* ignorado */ }
      } catch { /* ignorado */ }
    }, 600);
    if (walkType === 'local' && resolvedStops.length > 0) {
      const stopCoords = resolvedStops.map(s => [s.lng, s.lat] as [number, number]);
      const lastStop = stopCoords[stopCoords.length - 1];
      // Seed planned refs with straight lines so the dotted preview shows
      // immediately, but DON'T set routeCoordinates yet — wait for the
      // real walking route below so the dog walks streets, not buildings,
      // and the animation only starts once (no restart = no spinning).
      plannedOutboundRef.current = [start, ...stopCoords];
      plannedBackRef.current = lastStop ? [lastStop, start] : [start];
      whenReady(() => {
        drawPlannedLocalLayers();
        drawStopPins();
      });
    }
    setPhase('walking');
    onPickupComplete?.();
    if (walkType === 'local' && resolvedStops.length > 0) {
      buildLocalRoute(start, resolvedStops).then(({ outbound, back }) => {
        plannedOutboundRef.current = outbound;
        plannedBackRef.current = back;
        fillLocalRouteToDuration(outbound, back, walkDurationMinutes).then(({ wander }) => {
          const merged = wander.length > 1
            ? concatLegs(concatLegs(outbound, wander), back)
            : concatLegs(outbound, back);
          setRouteCoordinates(merged);
        });
        whenReady(() => {
          drawPlannedLocalLayers();
          drawStopPins();
        });
      });
    } else {
      buildWalkLoop(start).then(loop => setRouteCoordinates(loop));
    }
    // Zoom in close to the pet's location after code confirmation.
    if (map.current) {
      const target = start;
      lastUserInteractionRef.current = 0;
      cinematicBearingRef.current = -24;
      map.current.flyTo({
        center: target,
        zoom: 19.1,
        pitch: 66,
        bearing: pathBearingRef.current - 35,
        duration: 1600,
        essential: true,
      });
    }
  };

  // Trail is now persisted by the interval effect above (every ~4s)
  // using the in-memory `persistedTrailRef`. The previous per-prop save
  // was racy: it re-read the DB on every location change and frequently
  // overwrote a longer trail with a shorter one, which caused the
  // "rastro zerou" bug after reopening a long-running walk.

  // Phase 4.3 Patch 2: fluxo legado de conclusão unilateral REMOVIDO.
  // O PetWalker NÃO conclui o passeio — somente o Tutor chama
  // customer_confirm_arrival. petwalker_complete_walk permanece admin-only.

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const totalSec = walkDurationMinutes * 60;
  const remaining = Math.max(0, totalSec - elapsedTime);
  const progress = Math.min(100, (elapsedTime / totalSec) * 100);

  // Auto-transition based on time removed.
  // The UI will now only show "Tempo previsto excedido" via ActiveWalkBanner
  // and the walk must be explicitly concluded by the PetWalker.

  // When the user confirms a cancellation, we reuse the existing "return home"
  // animation. The moment the pet reaches home (remainingMeters/eta both zero
  // after the return animation has actually started), we auto-finalize the
  // cancel — no extra tap on "Confirmar chegada" needed.
  useEffect(() => {
    if (!isCancelling || !isReturning) return;
    if (cancelFiredRef.current) return;
    if (remainingMeters > 5 || etaSec > 0) return;
    // Guard: only fire once the return route has been laid out (remaining
    // started > 0 and then hit 0). We approximate by requiring phase==='walking'
    // and a small grace delay so we don't fire instantly on toggle.
    const t = window.setTimeout(() => {
      if (cancelFiredRef.current) return;
      cancelFiredRef.current = true;
      onCancelComplete?.();
    }, 800);
    return () => window.clearTimeout(t);
  }, [isCancelling, isReturning, remainingMeters, etaSec, onCancelComplete]);


  const recenter = () => {
    if (!map.current) return;
    const target = currentPetLocation || petLocation;
    if (!target) return;
    // After code confirmation (walking/arrived/returning), recenter with the
    // same close-up pet-focused framing used right after confirming the code.
    const closeUp = phase !== 'pickup';
    // Reset the idle clock so auto-follow resumes from the new framing.
    lastUserInteractionRef.current = 0;
    map.current.flyTo({
      center: target,
      zoom: closeUp ? 18.8 : 16,
      pitch: closeUp ? 60 : 45,
      bearing: 0,
      duration: 1200,
      essential: true,
    });
  };

  const fmtEta = (s: number) => {
    if (s <= 0) return 'chegando';
    if (s < 60) return `${s}s`;
    return `${Math.ceil(s / 60)} min`;
  };

  // Theme-aware tokens for floating chrome (top buttons + status pills).
  // In dark mode we use the same gray/black palette as SearchWalk so the
  // whole flow reads as one cohesive interface.
  const chrome = isDarkMode
    ? {
        bg: '#0B1410',
        border: '1px solid rgba(255,255,255,0.08)',
        text: '#F5F5F5',
        muted: 'rgba(255,255,255,0.55)',
        shadow: '0 8px 24px rgba(0,0,0,0.55)',
      }
    : {
        bg: 'rgba(255,255,255,0.92)',
        border: '1px solid rgba(0,0,0,0.06)',
        text: '#0F172A',
        muted: 'rgba(0,0,0,0.55)',
        shadow: '0 8px 24px rgba(0,0,0,0.18)',
      };

  return (
    // `fixed` + `100dvh` makes sure the overlay always matches the real
    // viewport on iOS Safari (the URL bar collapse/expand no longer crops
    // the map). `viewport-fit=cover` + safe-area insets keep nothing hidden
    // behind the notch / home indicator.
    <div
      className="fixed inset-0 z-30 bg-background"
      style={{ height: '100dvh', width: '100vw' }}
    >
      {/* During the walk the map should fill the entire viewport (no max-width
          centering), so the experience is truly fullscreen on mobile. The
          max-width is only applied when the bottom panel is showing. */}
      {/* Map fullscreen for every phase. The only remaining bottom UI is the
          "Confirmar chegada" CTA during the return leg. */}
      <div className="h-full w-full flex flex-col">
        {/* Header overlay */}
        <div className="absolute top-0 left-0 right-0 z-10 px-4 pt-safe-plus-lg pointer-events-none">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                if (isCancelling) return;
                // O botão voltar NUNCA conclui e NUNCA altera a sessão:
                // apenas volta para a home. O passeio segue ativo no backend
                // e pode ser retomado por ?resume=.
                onBack();
              }}
              className="pointer-events-auto w-11 h-11 backdrop-blur-sm rounded-full flex items-center justify-center active:scale-95 transition-transform"
              style={{ background: chrome.bg, border: chrome.border, boxShadow: chrome.shadow }}
              aria-label="Voltar para a Home"
            >
              <ArrowLeft className="w-5 h-5" style={{ color: chrome.text }} />
            </button>

            <div className="flex-1" />

            <div className="flex items-center gap-2">
              {onToggleTheme && (
                <button
                  onClick={onToggleTheme}
                  className="pointer-events-auto w-11 h-11 backdrop-blur-sm rounded-full flex items-center justify-center active:scale-95 transition-transform"
                  style={{ background: chrome.bg, border: chrome.border, boxShadow: chrome.shadow }}
                  aria-label={isDarkMode ? 'Modo claro' : 'Modo escuro'}
                >
                  {isDarkMode
                    ? <Sun className="w-5 h-5" style={{ color: '#31d880' }} />
                    : <Moon className="w-5 h-5" style={{ color: chrome.text }} />}
                </button>
              )}
              <button onClick={recenter} className="pointer-events-auto w-11 h-11 backdrop-blur-sm rounded-full flex items-center justify-center active:scale-95 transition-transform" style={{ background: chrome.bg, border: chrome.border, boxShadow: chrome.shadow }}>
                <Navigation className="w-5 h-5" style={{ color: chrome.text }} />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom fade — same soft gradient used in SearchWalk so floating
            controls/pills always sit on a readable backdrop instead of the bare map. */}
        <div
          className="absolute left-0 right-0 bottom-0 z-10 pointer-events-none"
          style={{
            height: 'calc(180px + env(safe-area-inset-bottom))',
            background: isDarkMode
              ? 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 35%, rgba(0,0,0,0) 100%)'
              : 'linear-gradient(to top, rgba(255,255,255,1) 0%, rgba(255,255,255,0.85) 35%, rgba(255,255,255,0) 100%)',
          }}
        />

        {/* Floating status pill — anchored to the BOTTOM (same language as
            the search/waiting pills) so the whole flow uses one consistent
            location. Morphs between pickup → arrived → walking → returning. */}
        {(
          <div
            className="absolute left-1/2 z-20 pointer-events-none"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)', transform: 'translateX(-50%)' }}
          >
            {(() => {
              const phaseKey = isReturning ? 'returning' : phase;
              if (isReturning) {
                return (
                  <div
                    key="returning"
                    data-testid="owner-returning-state"
                    className="pointer-events-auto flex items-center gap-3 backdrop-blur-md rounded-full pl-2 pr-2 py-2 animate-pill-content-in transition-all duration-500 ease-out min-w-[260px]"
                    style={{ background: chrome.bg, border: chrome.border, boxShadow: chrome.shadow }}
                  >
                    <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#31d880] flex-shrink-0">
                      {walkerAvatar
                        ? <img src={walkerAvatar} alt={walkerName} className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-[#31d880] text-white flex items-center justify-center font-extrabold">{walkerName.charAt(0).toUpperCase()}</div>}
                    </div>
                    <div className="flex flex-col leading-tight pr-1 flex-1">
                      <span className="text-[12px] font-semibold" style={{ color: chrome.muted }}>PetWalker retornando</span>
                      <span className="text-[15px] font-extrabold tabular-nums whitespace-nowrap" style={{ color: chrome.text }}>
                        {etaSec > 0 ? `Chega em ${fmtEta(etaSec)}` : 'Quase chegando…'}
                      </span>
                      <span className="text-[10px] font-medium leading-snug mt-0.5" style={{ color: chrome.muted }}>
                        Confirme somente quando o PetWalker estiver de volta com o pet.
                      </span>
                    </div>
                    <button
                      onClick={onConfirmArrival}
                      data-testid="confirm-return-arrival-button"
                      className="ml-1 pointer-events-auto h-10 px-3.5 rounded-full text-[13px] font-extrabold text-white flex items-center gap-1.5 active:scale-95 transition-transform whitespace-nowrap"
                      style={{ background: '#22C55E', boxShadow: '0 6px 18px rgba(34,197,94,0.35)' }}
                      aria-label="Confirmar chegada"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Confirmar chegada
                    </button>
                  </div>
                );
              }
              if (phase === 'walking' && !isReturning) {
                const R = 22;
                const C = 2 * Math.PI * R;
                const dash = (progress / 100) * C;
                return (
                  <div
                    key="walking"
                    className="pointer-events-auto flex flex-col items-center gap-2 animate-pill-content-in transition-all duration-500 ease-out"
                  >
                    {menuOpen && (
                      <div 
                        className="flex items-center gap-3 backdrop-blur-md rounded-full px-4 py-2 mb-1 animate-in fade-in slide-in-from-bottom-2 duration-300"
                        style={{ background: chrome.bg, border: chrome.border, boxShadow: chrome.shadow }}
                      >
                        <button
                          onClick={() => { setChatOpen(true); setMenuOpen(false); }}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <div className="w-10 h-10 rounded-full bg-[#31D880]/10 flex items-center justify-center text-[#31D880] group-active:scale-90 transition-all">
                            <MessageCircle className="w-5 h-5" />
                          </div>
                          <span className="text-[10px] font-bold" style={{ color: chrome.text }}>Chat</span>
                        </button>
                        
                        <button
                          onClick={() => { onRequestPhotos(); setMenuOpen(false); }}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <div className="w-10 h-10 rounded-full bg-[#31D880]/10 flex items-center justify-center text-[#31D880] group-active:scale-90 transition-all">
                            <Camera className="w-5 h-5" />
                          </div>
                          <span className="text-[10px] font-bold" style={{ color: chrome.text }}>Fotos</span>
                        </button>

                        <button
                          onClick={() => { setSupportOpen(true); setMenuOpen(false); }}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 group-active:scale-90 transition-all">
                            <Shield className="w-5 h-5" />
                          </div>
                          <span className="text-[10px] font-bold" style={{ color: chrome.text }}>Suporte</span>
                        </button>
                      </div>
                    )}

                    <div
                      className="flex items-center gap-3 backdrop-blur-md rounded-full pl-2 pr-5 py-2 min-w-[220px]"
                      style={{ background: chrome.bg, border: chrome.border, boxShadow: chrome.shadow }}
                    >
                      <div className="relative w-[56px] h-[56px] flex items-center justify-center bg-[#07150F] rounded-full">
                        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 56 56" width="56" height="56">
                          <circle cx="28" cy="28" r={R} fill="none" stroke={isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'} strokeWidth="3" />
                          <circle
                            cx="28" cy="28" r={R} fill="none"
                            stroke="hsl(159 100% 33%)" strokeWidth="3" strokeLinecap="round"
                            strokeDasharray={`${dash} ${C}`}
                            style={{ transition: 'stroke-dasharray 1s linear' }}
                          />
                        </svg>
                        <span className="text-xs font-extrabold tabular-nums leading-none" style={{ color: chrome.text }}>
                          {fmt(elapsedTime)}
                        </span>
                      </div>
                      <div className="flex flex-col leading-tight pr-1">
                        <span className="text-[12px] font-semibold" style={{ color: chrome.muted }}>Passeando</span>
                        <span className="text-[15px] font-extrabold" style={{ color: '#31d880' }}>{Math.round(progress)}%</span>
                      </div>
                      
                      <button
                        onClick={() => setMenuOpen(!menuOpen)}
                        className={`ml-1 pointer-events-auto w-10 h-10 rounded-full text-white flex items-center justify-center active:scale-95 transition-all duration-300 ${menuOpen ? 'rotate-180' : ''}`}
                        style={{ background: '#0B1410', boxShadow: '0 6px 18px rgba(0,0,0,0.25)' }}
                        aria-label="Mais opções"
                      >
                        {menuOpen ? <X className="w-[18px] h-[18px]" /> : <ChevronDown className="w-[18px] h-[18px]" />}
                      </button>
                    </div>
                    {/* CTA determinístico do Tutor — solicitar retorno via banco. */}
                    <button
                      onClick={async () => {
                        if (returnRequestLoading) return;
                        setReturnRequestLoading(true);
                        try {
                          if (onAuthorizeReturn) await onAuthorizeReturn();
                        } finally {
                          setReturnRequestLoading(false);
                        }
                      }}
                      data-testid="request-return-button"
                      disabled={returnRequestLoading}
                      className="pointer-events-auto flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-extrabold text-white active:scale-95 transition-transform disabled:opacity-60"
                      style={{ background: '#0B1410', boxShadow: '0 6px 18px rgba(0,0,0,0.25)' }}
                    >
                      {returnRequestLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Home className="w-4 h-4" />}
                      Voltar para casa
                    </button>
                  </div>
                );
              }
              if (phase === 'pickup') {
                return (
                  <div
                    key="pickup"
                    data-testid="walk-accepted-state"
                    className="pointer-events-auto flex items-center gap-3.5 backdrop-blur-md rounded-full pl-2 pr-3 py-2 animate-pill-content-in transition-all duration-500 ease-out min-w-[260px]"
                    style={{ background: chrome.bg, border: chrome.border, boxShadow: chrome.shadow }}
                  >
                    <div className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-[#31d880]">
                      {walkerAvatar
                        ? <img src={walkerAvatar} alt={walkerName} className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-[#31d880] text-white flex items-center justify-center font-extrabold">{walkerName.charAt(0).toUpperCase()}</div>}
                    </div>
                    <div className="flex flex-col leading-tight pr-2 flex-1">
                      <span className="text-[12px] font-semibold" style={{ color: chrome.muted }}>A caminho {transport?.emoji ?? '🚗'}</span>
                      <span className="text-[15px] font-extrabold whitespace-nowrap" style={{ color: chrome.text }} data-testid="walk-walker-name">{walkerName}</span>
                      <span className="text-[12px] font-semibold tabular-nums whitespace-nowrap" style={{ color: chrome.muted }}>{fmtEta(etaSec)}</span>
                    </div>
                    <button
                      onClick={onOpenChat}
                      className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-all"
                      style={{ background: isDarkMode ? 'rgba(49,216,128,0.2)' : 'rgba(49,216,128,0.12)' }}
                      aria-label="Conversar"
                    >
                      <MessageCircle className="w-[18px] h-[18px]" style={{ color: '#31d880' }} />
                    </button>
                  </div>
                );
              }
              return (
                <div
                  key={phaseKey}
                  className="pointer-events-auto flex items-center gap-2.5 backdrop-blur-md rounded-full px-5 py-3 animate-pill-content-in transition-all duration-500 ease-out"
                  style={{ background: chrome.bg, border: chrome.border, boxShadow: chrome.shadow }}
                >
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm font-bold" style={{ color: chrome.text }}>
                    {phase === 'arrived' ? 'Chegou' : isReturning ? 'Retornando' : 'Ao Vivo'}
                  </span>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: '#31d880' }}>{fmt(elapsedTime)}</span>
                </div>
              );
            })()}
          </div>
        )}

        {!menuOpen && phase === 'walking' && !isReturning && (
          <div
            className="absolute left-1/2 z-20"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 36px)', transform: 'translateX(-50%)' }}
          >
            <button
              onClick={() => setSupportOpen(true)}
              className="text-[11.5px] font-semibold underline-offset-4 hover:underline active:scale-95 transition-transform"
              style={{ color: chrome.muted }}
            >
              Precisa de ajuda?
            </button>
          </div>
        )}

        {/* Map */}
        <div className="flex-1 relative">
          <div ref={mapContainer} className="w-full h-full" />

          {/* Side actions (chat/photo/call/return) intentionally removed
              for a cleaner walking screen. Theme toggle lives in the top
              header next to the recenter button. */}


        </div>

        {/* Return leg UI is rendered as a floating pill (above) to match
            the rest of the walk's design language. No bottom panel. */}

        {/* Code confirmation overlay — appears when walker arrives to pick up pet */}
        {phase === 'arrived' && (
          (() => {
            const surface = isDarkMode ? '#0a0d0c' : '#ffffff';
            const ink = isDarkMode ? '#f5f7f6' : '#0a1a14';
            const inkSoft = isDarkMode ? 'rgba(245,247,246,0.6)' : 'rgba(10,26,20,0.55)';
            const inkFaint = isDarkMode ? 'rgba(245,247,246,0.4)' : 'rgba(10,26,20,0.4)';
            const hairline = isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(10,26,20,0.08)';
            const inputBg = isDarkMode ? 'rgba(255,255,255,0.04)' : '#f7f8f7';
            const inputBorder = isDarkMode ? 'rgba(255,255,255,0.10)' : 'rgba(10,26,20,0.10)';
            return (
              <div className="absolute inset-0 z-40 flex items-center justify-center p-4 animate-fade-in"
                style={{ background: isDarkMode ? 'rgba(0,0,0,0.72)' : 'rgba(10,26,20,0.55)', backdropFilter: 'blur(10px)' }}>
                <div
                  className="w-full max-w-[360px] rounded-[28px] p-6 animate-scale-in"
                  style={{
                    background: surface,
                    border: `1px solid ${hairline}`,
                    boxShadow: isDarkMode
                      ? '0 24px 60px -10px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04) inset'
                      : '0 24px 60px -10px rgba(10,26,20,0.25)',
                  }}
                >
                  <div className="flex flex-col items-center text-center">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                      style={{ background: 'linear-gradient(135deg, hsl(159 100% 33%), hsl(159 100% 27%))', boxShadow: '0 10px 24px -8px rgba(0,169,120,0.55)' }}>
                      <KeyRound className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="text-lg font-extrabold" style={{ color: ink }}>{walkerName} chegou!</h3>
                    <p className="text-sm mt-1 mb-5" style={{ color: inkSoft }}>
                      Peça o código de 6 dígitos que o cliente está visualizando para confirmar a retirada.
                    </p>

                    <div className="flex gap-1.5 mb-3">
                      {[0, 1, 2, 3, 4, 5].map(i => (
                        <input
                          key={i}
                          inputMode="numeric"
                          maxLength={1}
                          value={codeInput[i] || ''}
                          data-testid="pickup-pin-input"
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, '').slice(-1);
                            const arr = codeInput.padEnd(6, ' ').split('');
                            arr[i] = v || ' ';
                            setCodeInput(arr.join('').trimEnd());
                            if (v && e.target.nextElementSibling) (e.target.nextElementSibling as HTMLInputElement).focus();
                          }}
                          className="w-10 h-14 text-center text-xl font-extrabold rounded-xl border-2 focus:outline-none transition-colors"
                          style={{
                            background: inputBg,
                            color: ink,
                            borderColor: codeError ? '#ef4444' : inputBorder,
                          }}
                        />
                      ))}
                    </div>
                    {codeError && <p className="text-xs text-red-500 mb-2">Código incorreto, tente novamente</p>}

                    <button
                      onClick={handleConfirmCode}
                      data-testid="pickup-pin-submit"
                      disabled={codeInput.length !== 6 || concluding}
                      className="w-full py-3.5 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40"
                      style={{ background: 'linear-gradient(135deg, hsl(159 100% 33%), hsl(159 100% 27%))', boxShadow: '0 6px 18px -6px rgba(0,169,120,0.55)' }}
                    >
                      {concluding ? 'Validando...' : 'Confirmar e iniciar passeio'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()
        )}


        {/* Dialogo de cancelamento — disparado pelo botão Voltar durante o
            passeio. Confirmar dispara a animação de retorno do pet para casa
            e só então o passeio é efetivamente cancelado. */}

        {/* Banner sutil indicando que o cancelamento está em andamento. */}
        {isCancelling && (
          <div
            className="absolute top-[88px] left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full text-xs font-semibold animate-fade-in pointer-events-none"
            style={{
              background: chrome.bg,
              border: chrome.border,
              boxShadow: chrome.shadow,
              color: chrome.text,
            }}
          >
            Cancelando • {petName} voltando para casa…
          </div>
        )}

        {/* Pop-up de chat com o PetWalker Beta */}
        <PetwalkerChat
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onAuthorizeReturn={async () => {
            if (!onAuthorizeReturn) return false;
            return onAuthorizeReturn();
          }}
          petName={petName}
          walkerName={walkerName}
          walkerAvatar={walkerAvatar}
          walkType={walkType}
          plannedMinutes={walkDurationMinutes}
          elapsedMinutes={Math.floor(elapsedTime / 60)}
          isReturning={isReturning}
        />

        {/* Pop-up de Suporte VaiPet ao vivo */}
        <SupportChat
          open={supportOpen}
          onClose={() => setSupportOpen(false)}
          isDarkMode={isDarkMode}
        />
      </div>
    </div>
  );
};
