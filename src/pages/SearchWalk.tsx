import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import { hideMapLabels, enrichMap, tintMapInk } from '@/lib/mapStyle';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ArrowLeft, Plus, Minus, Navigation, Sun, Moon, ChevronDown, MapPin, Clock, DollarSign, PawPrint, X, Sparkles, Map as MapIcon, Compass, Search, Trash2, Loader2, GripVertical, Cloud, CloudRain, CloudSnow, CloudFog, CloudLightning, CloudSun } from 'lucide-react';
import { Calendar as CalendarIcon, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { supabase } from '@/integrations/supabase/client';
import { RouteInfo } from '../components/RouteInfo';
import { WaitingForAcceptance } from '../components/WaitingForAcceptance';
import { WalkInProgress } from '../components/WalkInProgress';
import { ReviewWalk } from '../components/ReviewWalk';
import { CancelWalkDialog } from '../components/CancelWalkDialog';
import { BottomNavigation } from '../components/BottomNavigation';
import { pickTransportForDistance, TransportInfo, WalkerProfile } from '@/lib/walkerProfile';
import { preloadDog3DAsset } from '@/lib/dog3dLayer';
import { preloadCheckpointAsset } from '@/lib/checkpoint3dLayer';
import { SlideToConfirm } from '../components/SlideToConfirm';
import { toast } from 'sonner';
import type { WalkStatus } from '@/types/walk';

/** Estados em que a sessão é rastreável (posição do walker disponível). */
export const TRACKABLE_WALK_STATUSES = [
  'accepted',
  'heading_to_pickup',
  'arrived',
  'in_progress',
  'returning',
] as const;
export type TrackableWalkStatus = typeof TRACKABLE_WALK_STATUSES[number];
const isTrackableStatus = (s: string | null | undefined): s is TrackableWalkStatus =>
  !!s && (TRACKABLE_WALK_STATUSES as readonly string[]).includes(s);

interface Pet {
  id: string;
  name: string;
  avatar_url?: string;
  behavioral_notes?: string;
}

const distanceMeters = (a: [number, number], b: [number, number]) => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// Map Open-Meteo WMO weather codes to icon + walk-friendly label.
const describeWeather = (code: number, isDay: boolean) => {
  if (code === 0)
    return { Icon: isDay ? Sun : Moon, label: isDay ? 'Dia bom pra passear' : 'Noite limpa' };
  if ([1, 2].includes(code)) return { Icon: CloudSun, label: 'Parcialmente nublado' };
  if (code === 3) return { Icon: Cloud, label: 'Nublado' };
  if ([45, 48].includes(code)) return { Icon: CloudFog, label: 'Neblina' };
  if ([51, 53, 55, 56, 57].includes(code)) return { Icon: CloudRain, label: 'Garoa fina' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return { Icon: CloudRain, label: 'Chuva' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { Icon: CloudSnow, label: 'Neve' };
  if ([95, 96, 99].includes(code)) return { Icon: CloudLightning, label: 'Tempestade' };
  return { Icon: Cloud, label: 'Tempo estável' };
};
const isRainCode = (code: number) =>
  [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);

// Classifica a intensidade da chuva combinando o código WMO (drizzle vs.
// rain vs. heavy rain vs. thunderstorm) com a precipitação em mm/h do
// Open-Meteo. Retorna parâmetros prontos para a animação de gotas.
type RainIntensity = {
  level: 'light' | 'moderate' | 'heavy';
  label: string;
  drops: number;
  minDuration: number; // segundos
  maxDuration: number;
  dropHeight: number;  // px
  dropWidth: number;   // px
  opacityBase: number; // 0-1
  wash: number;        // 0-1, intensidade do wash azulado
};

const classifyRain = (code: number, precipMm: number): RainIntensity => {
  // Garoa / drizzle (51-57) ou precipitação muito baixa
  const drizzle = [51, 53, 55, 56, 57].includes(code);
  // Chuva forte / heavy: 65, 67, 82 ou tempestade 95/96/99 ou >4 mm/h
  const heavyCode = [65, 67, 82, 95, 96, 99].includes(code);

  let level: RainIntensity['level'];
  if (heavyCode || precipMm >= 4) level = 'heavy';
  else if (drizzle || precipMm < 0.6) level = 'light';
  else level = 'moderate';

  if (level === 'light') {
    return {
      level,
      label: 'Garoa fina',
      drops: 55,
      minDuration: 0.9,
      maxDuration: 1.6,
      dropHeight: 18,
      dropWidth: 1,
      opacityBase: 0.18,
      wash: 0.06,
    };
  }
  if (level === 'moderate') {
    return {
      level,
      label: 'Chuva moderada',
      drops: 130,
      minDuration: 0.55,
      maxDuration: 1.0,
      dropHeight: 28,
      dropWidth: 1.5,
      opacityBase: 0.3,
      wash: 0.12,
    };
  }
  return {
    level,
    label: 'Chuva forte',
    drops: 220,
    minDuration: 0.32,
    maxDuration: 0.6,
    dropHeight: 42,
    dropWidth: 2,
    opacityBase: 0.45,
    wash: 0.2,
  };
};

const SearchWalk = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, profile } = useAuth();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const userMarker = useRef<mapboxgl.Marker | null>(null);
  const walkerMarker = useRef<mapboxgl.Marker | null>(null);
  // Remember the last drawn route so we can re-add the layer after a
  // style swap (day↔night) WITHOUT re-fetching or re-animating it.
  const currentRouteCoords = useRef<[number, number][] | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const userLocationRef = useRef<[number, number] | null>(null);
  const lastUserLocationStateAtRef = useRef(0);
  
  const [selectedMinutes, setSelectedMinutes] = useState(30);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');

  const [quote, setQuote] = useState<{
    duration_minutes: number;
    price_per_minute_cents: number;
    request_surcharge_cents: number;
    total_price_cents: number;
    pricing_version: number;
    request_mode: string;
  } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const fetchQuote = useCallback(async (duration: number, mode: 'now' | 'scheduled') => {
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const { data, error } = await supabase.rpc('get_walk_quote', {
        _duration_minutes: duration,
        _request_mode: mode
      });
      if (error) throw error;
      if (data) {
        const quote = data?.[0] ?? null;
        setQuote(quote);
      } else {
        setQuote(null);
      }
    } catch (err: unknown) {
      console.error('Quote error:', err);
      setQuoteError('Orçamento indisponível');
      setQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuote(selectedMinutes, scheduleMode === 'now' ? 'now' : 'scheduled');
  }, [selectedMinutes, scheduleMode, fetchQuote]);

  // Marker-level throttling for GPS updates.
  const lastMarkerUpdateAtRef = useRef(0);
  const lastMarkerPosRef = useRef<[number, number] | null>(null);
  const pendingLocRef = useRef<[number, number] | null>(null);
  const watchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // EMA filter for GPS smoothing.
  const emaPosRef = useRef<[number, number] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'found' | 'waiting' | 'accepted' | 'walking' | 'reviewing' | 'error'>('idle');
  const searchStatusRef = useRef(searchStatus);
  const isSearchingRef = useRef(isSearching);
  // Acceptance handoff guards.
  const sessionCreatedRef = useRef(false);
  const recoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ duration: number; distance: number } | null>(null);
  const [isDrawingRoute, setIsDrawingRoute] = useState(false);
  const [walkerLocation, setWalkerLocation] = useState<[number, number] | null>(null);
  // Posição atual real do PetWalker (RPC get_active_walker_location).
  const [liveWalkerPosition, setLiveWalkerPosition] = useState<{ lng: number; lat: number; ts: number } | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  // Tema da tela segue a decisão global.
  // O mapa segue o clima real (dia/noite) por padrão.
  const { theme, toggle: toggleTheme } = useHomeTheme();
  // Clima atual no local do usuário (Open-Meteo). `precip` é mm na última
  // hora — usado para escalar a intensidade da animação de chuva.
  const [weather, setWeather] = useState<{
    temp: number;
    code: number;
    isDay: boolean;
    precip: number;
  } | null>(null);
  
  const isDayMode = theme === 'light';
  // Use weather data to determine if the map should be dark or light.
  // Falls back to UI theme if weather hasn't loaded.
  const mapIsDay = weather ? weather.isDay : isDayMode;
  const [pets, setPets] = useState<Pet[]>([]);
  const [selectedPets, setSelectedPets] = useState<Pet[]>([]);
  const [showPetSelector, setShowPetSelector] = useState(false);
  const [walkStartTime, setWalkStartTime] = useState<number>(0);
  const [walkDuration, setWalkDuration] = useState<number>(0);
  const [showMoreDurations, setShowMoreDurations] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [scheduleTime, setScheduleTime] = useState<string>('09:00');
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [walkType, setWalkType] = useState<'livre' | 'local'>('livre');
  const [walkTypeNotes, setWalkTypeNotes] = useState<string>('');
  // Local-walk stops: real geocoded addresses the walker must pass through.
  type LocalStop = { id: string; label: string; address: string; lng: number; lat: number };
  const [localStops, setLocalStops] = useState<LocalStop[]>([]);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [addrQuery, setAddrQuery] = useState('');
  const [addrSuggestions, setAddrSuggestions] = useState<Array<{ id: string; place_name: string; text: string; center: [number, number] }>>([]);
  const [addrLoading, setAddrLoading] = useState(false);
  const [plannedRouteInfo, setPlannedRouteInfo] = useState<{ distance: number; duration: number } | null>(null);
  const stopMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  // ────────────────────────────────────────────────────────────────
  // Estado OPERACIONAL (domínio): vem exclusivamente do banco
  // (`walk_sessions.current_status`). É a única fonte de verdade para
  // rastreamento/polling. `searchStatus` continua sendo apenas estado
  // de APRESENTAÇÃO (animações e qual componente aparece).
  // ────────────────────────────────────────────────────────────────
  const [sessionStatus, setSessionStatus] = useState<WalkStatus | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(true);
  const [walker, setWalker] = useState<WalkerProfile | null>(null);
  const [pickupRoute, setPickupRoute] = useState<[number, number][]>([]);
  const [transport, setTransport] = useState<TransportInfo | null>(null);
  // Resume walk state.
  const [isResuming, setIsResuming] = useState<boolean>(() => !!searchParams.get('resume'));
  const resumeHandledRef = useRef(false);
  // Return phase state.
  const [isReturning, setIsReturning] = useState(false);
  const [matchingExpiresAt, setMatchingExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    searchStatusRef.current = searchStatus;
    isSearchingRef.current = isSearching;
  }, [searchStatus, isSearching]);

  const commitUserLocation = useCallback((loc: [number, number], force = false) => {
    const prev = userLocationRef.current;
    userLocationRef.current = loc;
    const activeMapFlow = searchStatusRef.current !== 'idle' || isSearchingRef.current;
    const moved = prev ? distanceMeters(prev, loc) : Infinity;
    const now = Date.now();
    if (force || !prev || (!activeMapFlow && moved >= 50 && now - lastUserLocationStateAtRef.current > 10000)) {
      lastUserLocationStateAtRef.current = now;
      setUserLocation(loc);
    }
  }, []);

  useEffect(() => {
    if (user) fetchPets();
  }, [user]);

  // ---------- RESUME an active walk from the home banner ----------
  // The Home screen's "Passeio em andamento" banner navigates here with
  // ?resume=<walk_session_id>. We rebuild the minimum state required to
  // mount <WalkInProgress isComing={false}> so the user picks up exactly
  // where they left off (timer, pet, walk type, stops, home location).
  useEffect(() => {
    const sessionId = searchParams.get('resume');
    if (!sessionId || !user || resumeHandledRef.current) return;
    resumeHandledRef.current = true;
    (async () => {
      try {
        const { data: session, error } = await supabase
          .from('walk_sessions')
          .select('*')
          .eq('id', sessionId)
          .eq('customer_id', user.id)
          .maybeSingle();
        if (error || !session) {
          setIsResuming(false);
          setSearchParams({}, { replace: true });
          return;
        }
        // If the walk is already finished, drop back to the normal flow.
        if (session.current_status !== 'in_progress' && session.current_status !== 'returning') {
          setIsResuming(false);
          setSearchParams({}, { replace: true });
          return;
        }
        // Hydrate the pet
        const petIds = session.pet_ids || [session.pet_id].filter(Boolean);
        const { data: petList } = await supabase
          .from('pets')
          .select('id, name, avatar_url')
          .in('id', petIds);
        if (petList) setSelectedPets(petList as Pet[]);

        // Hydrate stops + home location
        const stops = Array.isArray(session.local_stops) ? session.local_stops : [];
        setLocalStops(
          (stops as Array<{ label?: string; address?: string; lng: number; lat: number }>).map((s, i) => ({
            id: `${sessionId}-${i}`,
            label: s.label ?? `Parada ${i + 1}`,
            address: s.address ?? '',
            lng: Number(s.lng),
            lat: Number(s.lat),
          })),
        );
        setWalkType((session.walk_type as 'livre' | 'local') || 'livre');
        setSelectedMinutes(session.planned_duration_minutes || 30);

        const home = session.home_location as { lng: number; lat: number } | null;
        if (home && Number.isFinite(home.lng) && Number.isFinite(home.lat)) {
          commitUserLocation([home.lng, home.lat], true);
          // On resume, the walker has already arrived — anchor the walker
          // marker at the pet's home so WalkInProgress mounts cleanly
          // (walkerMarker.setLngLat would crash on null).
          setWalkerLocation([home.lng, home.lat]);
        } else {
          const fallback: [number, number] = userLocation ?? [-46.6333, -23.5505];
          commitUserLocation(fallback, true);
          setWalkerLocation(fallback);
        }

        // setWalker(null); // Explicitly null while searching
        setCurrentSessionId(session.id);
        setSessionStatus(session.current_status as WalkStatus);
        setWalkStartTime(new Date(session.start_time).getTime());
        if (session.current_status === 'returning') setIsReturning(true);
        setSearchStatus('walking');
      } catch (e) {
        console.error('Resume walk failed:', e);
        setIsResuming(false);
        setSearchParams({}, { replace: true });
      }
    })();
  }, [searchParams, user, setSearchParams, commitUserLocation, userLocation]);

  useEffect(() => {
    let watchId: number;
    const MIN_MARKER_INTERVAL_MS = 1500; // hard rate limit between marker moves
    const MIN_MARKER_MOVE_M = 4;          // ignore sub-jitter GPS noise
    const TRAILING_DEBOUNCE_MS = 600;     // ensure last sample is applied
    const SNAP_DISTANCE_M = 60;           // huge jump → reset filter (teleport)

    // Accuracy-aware EMA smoothing.
    const smoothLocation = (raw: [number, number], accuracy?: number): [number, number] => {
      const prev = emaPosRef.current;
      if (!prev) {
        emaPosRef.current = raw;
        return raw;
      }
      const jumpM = distanceMeters(prev, raw);
      // Teleport / first fix after long pause: trust the new sample.
      if (jumpM > SNAP_DISTANCE_M) {
        emaPosRef.current = raw;
        return raw;
      }
      const acc = typeof accuracy === 'number' && accuracy > 0 ? accuracy : 25;
      let alpha = 0.5 - Math.min(0.42, (acc - 10) / 100); // 10m→0.5, 50m→0.1
      alpha = Math.max(0.08, Math.min(0.6, alpha));
      // If the user is clearly moving (big jump but under snap threshold),
      // ease toward the new sample faster to avoid trailing.
      if (jumpM > 15) alpha = Math.min(0.7, alpha + 0.2);
      const smoothed: [number, number] = [
        prev[0] + (raw[0] - prev[0]) * alpha,
        prev[1] + (raw[1] - prev[1]) * alpha,
      ];
      emaPosRef.current = smoothed;
      return smoothed;
    };

    const applyMarker = (loc: [number, number]) => {
      lastMarkerUpdateAtRef.current = Date.now();
      lastMarkerPosRef.current = loc;
      pendingLocRef.current = null;
      if (map.current && userMarker.current) userMarker.current.setLngLat(loc);
    };

    const scheduleTrailing = () => {
      if (watchDebounceTimerRef.current) clearTimeout(watchDebounceTimerRef.current);
      watchDebounceTimerRef.current = setTimeout(() => {
        const loc = pendingLocRef.current;
        if (loc) applyMarker(loc);
      }, TRAILING_DEBOUNCE_MS);
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => commitUserLocation([position.coords.longitude, position.coords.latitude], true),
        () => commitUserLocation([-46.6333, -23.5505], true)
      );
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const raw: [number, number] = [position.coords.longitude, position.coords.latitude];
          // Smooth the raw GPS sample with an accuracy-aware EMA. This is the
          // single source of truth for the marker AND for downstream state,
          // so map effects and the marker stop chasing GPS noise on mobile.
          const loc = smoothLocation(raw, position.coords.accuracy);
          // React state update is already throttled inside commitUserLocation.
          commitUserLocation(loc);
          // Marker updates: rate-limit + min-movement + trailing debounce so
          // mobile GPS noise can't make the map flicker every second.
          const now = Date.now();
          const lastPos = lastMarkerPosRef.current;
          const moved = lastPos ? distanceMeters(lastPos, loc) : Infinity;
          if (moved < MIN_MARKER_MOVE_M) {
            // Pure jitter: remember it but don't repaint.
            pendingLocRef.current = loc;
            scheduleTrailing();
            return;
          }
          if (now - lastMarkerUpdateAtRef.current < MIN_MARKER_INTERVAL_MS) {
            // Rate-limit paint.
            pendingLocRef.current = loc;
            scheduleTrailing();
            return;
          }
          applyMarker(loc);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    } else {
      commitUserLocation([-46.6333, -23.5505], true);
    }
    return () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
      if (watchDebounceTimerRef.current) {
        clearTimeout(watchDebounceTimerRef.current);
        watchDebounceTimerRef.current = null;
      }
      emaPosRef.current = null;
    };
  }, [commitUserLocation]);

  // Fetch current weather for the user's location (Open-Meteo, no key).
  useEffect(() => {
    if (!userLocation) return;
    let cancel = false;
    (async () => {
      try {
        const [lng, lat] = userLocation;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,is_day,precipitation,rain,showers&timezone=auto`;
        const r = await fetch(url);
        const j = await r.json();
        if (cancel) return;
        const c = j?.current;
        if (typeof c?.temperature_2m === 'number') {
          const precip = Math.max(
            Number(c.precipitation ?? 0) || 0,
            Number(c.rain ?? 0) || 0,
            Number(c.showers ?? 0) || 0,
          );
          setWeather({
            temp: Math.round(c.temperature_2m),
            code: Number(c.weather_code ?? 0),
            isDay: Number(c.is_day ?? 1) === 1,
            precip,
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
    // Only refresh when location materially changes (first fix is enough for UI).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!userLocation]);

  const fetchPets = async () => {
    try {
      const { data, error } = await supabase
        .from('pets')
        .select('id, name, avatar_url, behavioral_notes')
        .eq('owner_id', user?.id)
        .eq('is_active', true);
      if (error) throw error;
      const petData = data || [];
      setPets(petData);
      if (petData.length === 1) setSelectedPets([petData[0]]);
    } catch (error) {
      console.error('Error fetching pets:', error);
    }
  };

  useEffect(() => {
    if (!mapContainer.current || !userLocation || map.current) return;
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/standard",
      center: userLocation,
      zoom: 15,
      pitch: 45,
      bearing: 0,
      antialias: true,
      config: {
        basemap: {
          lightPreset: mapIsDay ? "day" : "night",
          theme: mapIsDay ? "faded" : "default",
          show3dObjects: false,
          showPointOfInterestLabels: false,
          showTransitLabels: false,
          showAdminBoundaries: false,
          showPlaceLabels: true,
          showRoadLabels: true,
          showPedestrianRoads: true,
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
    map.current.on('load', () => {
      if (!map.current) return;
      hideMapLabels(map.current);
      enrichMap(map.current, mapIsDay);
      tintMapInk(map.current, !mapIsDay);
    });

    const getUserInitials = (name: string) => name.split(' ').map(w => w.charAt(0)).join('').toUpperCase().slice(0, 2);
    const markerElement = document.createElement('div');
    markerElement.className = 'relative w-10 h-10';
    const userAvatarUrl = profile?.avatar_url;
    const userName = user?.user_metadata?.full_name || profile?.full_name || 'U';
    markerElement.innerHTML = `
      <div class="absolute inset-0 rounded-full bg-[#31d880] animate-ping opacity-30" style="animation-duration: 2s; transform: scale(1.6);"></div>
      <div class="relative w-10 h-10 rounded-full border-3 border-[#31d880] overflow-hidden bg-[#07150F] shadow-lg flex items-center justify-center">
        ${userAvatarUrl ? `<img src="${userAvatarUrl}" alt="User" class="w-full h-full object-cover" />` : `<span class="text-xs font-bold text-white">${getUserInitials(userName)}</span>`}
      </div>
    `;
    userMarker.current = new mapboxgl.Marker(markerElement).setLngLat(userLocation).addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
    // Init the map only ONCE, when we first get a location. Subsequent
    // Map init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!userLocation]);

  // Swap basemap + re-tint when the user toggles light/dark or weather updates.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    
    const applyStyle = () => {
      try {
        const isDay = mapIsDay;
        m.setConfigProperty('basemap', 'lightPreset', isDay ? 'day' : 'night');
        m.setConfigProperty('basemap', 'theme', isDay ? 'faded' : 'default');
        
        if (isDay) {
          // Pastel day mode.
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
          // Night mode (Ink theme).
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
        console.warn('Failed to update map style:', e);
      }
    };

    if (m.isStyleLoaded()) {
      applyStyle();
    } else {
      m.once('styledata', applyStyle);
    }
  }, [mapIsDay]);

  // Sync user marker avatar.
  useEffect(() => {
    const el = userMarker.current?.getElement();
    if (!el) return;
    const avatarUrl = profile?.avatar_url;
    const name = user?.user_metadata?.full_name || profile?.full_name || 'U';
    const initials = name.split(' ').map((w: string) => w.charAt(0)).join('').toUpperCase().slice(0, 2);
    const inner = el.querySelector('div.relative');
    if (!inner) return;
    inner.innerHTML = avatarUrl
      ? `<img src="${avatarUrl}" alt="User" class="w-full h-full object-cover" />`
      : `<span class="text-xs font-bold text-white">${initials}</span>`;
  }, [profile?.avatar_url, profile?.full_name, user?.user_metadata?.full_name]);

  // ---------- LOCAL WALK: address geocoding (debounced) ----------
  useEffect(() => {
    const q = addrQuery.trim();
    if (q.length < 2) { setAddrSuggestions([]); setAddrLoading(false); return; }
    setAddrLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        // Google Places search via Edge Function.
        const { data, error } = await supabase.functions.invoke('places-search', {
          body: {
            query: q,
            lat: userLocation?.[1],
            lng: userLocation?.[0],
            radius: 20000,
          },
        });
        if (error) throw error;
        type PlaceResult = { id: string; address: string; name: string; lng: number; lat: number };
        const feats = ((data?.results || []) as PlaceResult[]).map((r) => ({
          id: r.id,
          place_name: r.address,
          text: r.name,
          center: [r.lng, r.lat] as [number, number],
        }));
        setAddrSuggestions(feats);
      } catch (e: unknown) {
        if ((e as { name?: string })?.name !== 'AbortError') setAddrSuggestions([]);
      } finally {
        setAddrLoading(false);
      }
    }, 350);
    return () => { ctrl.abort(); clearTimeout(t); };
  }, [addrQuery, userLocation]);

  // ---------- LOCAL WALK: draw planned route through user + stops ----------
  useEffect(() => {
    if (!map.current) return;
    const m = map.current;
    const ensureRemoved = () => {
      if (m.getLayer('planned-route')) m.removeLayer('planned-route');
      if (m.getSource('planned-route')) m.removeSource('planned-route');
      if (m.getLayer('walker-route')) m.removeLayer('walker-route');
      if (m.getSource('walker-route')) m.removeSource('walker-route');
      stopMarkersRef.current.forEach((mk) => mk.remove());
      stopMarkersRef.current = [];
    };
    // Planned route preview.
    const shouldDraw = step === 2;
    if (!shouldDraw || walkType !== 'local' || !userLocation || localStops.length === 0) {
      ensureRemoved();
      setPlannedRouteInfo(null);
      return;
    }
    // Add numbered stop markers
    ensureRemoved();
    localStops.forEach((s, i) => {
      const el = document.createElement('div');
      el.style.cssText = 'width:28px;height:28px;border-radius:9999px;background:#31d880;color:#fff;font-weight:800;font-size:13px;line-height:1;border:2px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;font-family:inherit;';
      el.textContent = String(i + 1);
      const mk = new mapboxgl.Marker(el).setLngLat([s.lng, s.lat]).addTo(m);
      stopMarkersRef.current.push(mk);
    });
    // USER confirmation route loop (solid).
    const loopPoints: [number, number][] = [userLocation, ...localStops.map((s) => [s.lng, s.lat] as [number, number]), userLocation];
    // WALKER route trajectory (dashed).
    const walkerPoints: [number, number][] = [userLocation, ...localStops.map((s) => [s.lng, s.lat] as [number, number])];
    const coordStr = loopPoints.map((p) => `${p[0]},${p[1]}`).join(';');
    const walkerCoordStr = walkerPoints.map((p) => `${p[0]},${p[1]}`).join(';');
    let cancelled = false;
    (async () => {
      try {
        const [res, walkerRes] = await Promise.all([
          fetch(`https://api.mapbox.com/directions/v5/mapbox/walking/${coordStr}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`),
          walkerPoints.length >= 2
            ? fetch(`https://api.mapbox.com/directions/v5/mapbox/walking/${walkerCoordStr}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`)
            : Promise.resolve<Response | null>(null),
        ]);
        const json = await res.json();
        if (cancelled) return;
        const route = json.routes?.[0];
        if (!route) return;
        const data = { type: 'Feature' as const, properties: {}, geometry: route.geometry };
        if (m.getSource('planned-route')) {
          (m.getSource('planned-route') as mapboxgl.GeoJSONSource).setData(data);
        } else {
          m.addSource('planned-route', { type: 'geojson', data });
          m.addLayer({
            id: 'planned-route',
            type: 'line',
            source: 'planned-route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#31D880',
              'line-width': 5,
              'line-opacity': 1,
            },
          });
        }
        // Walker dashed overlay (one-way). Rendered ABOVE the solid loop.
        if (walkerRes) {
          const wjson = await walkerRes.json();
          const wroute = wjson.routes?.[0];
          if (wroute) {
            const wdata = { type: 'Feature' as const, properties: {}, geometry: wroute.geometry };
            if (m.getSource('walker-route')) {
              (m.getSource('walker-route') as mapboxgl.GeoJSONSource).setData(wdata);
            } else {
              m.addSource('walker-route', { type: 'geojson', data: wdata });
              m.addLayer({
                id: 'walker-route',
                type: 'line',
                source: 'walker-route',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                  'line-color': '#9CA3AF',
                  'line-width': 3,
                  'line-opacity': 0.75,
                  'line-dasharray': [1.4, 1.6],
                },
              });
            }
          }
        }
        setPlannedRouteInfo({ distance: route.distance, duration: route.duration });
        // Frame route
        const bounds = new mapboxgl.LngLatBounds();
        loopPoints.forEach((p) => bounds.extend(p));
        const h = window.innerHeight;
        m.fitBounds(bounds, {
          padding: { top: 100, bottom: Math.round(h * 0.55), left: 50, right: 50 },
          duration: 1200,
        });
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [localStops, walkType, step, userLocation]);

  // Center user marker above bottom sheet.
  useEffect(() => {
    if (!map.current || !userLocation) return;
    // Only re-pad the map when the SCHEDULE sheet opens/closes — otherwise
    // a transition like "found → waiting" would interrupt the fitBounds
    // animation that just framed the user + walker, causing a visible flick.
    const h = window.innerHeight;
    const safeBottom = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--sai-b') || '0',
      10,
    ) || 0;
    const sheetOpen = searchStatus === 'idle' && !isSearching;
    const padBottom = sheetOpen ? Math.round(h * 0.5) + safeBottom : 0;
    map.current.easeTo({
      center: userLocation,
      padding: { top: 80, bottom: padBottom, left: 0, right: 0 },
      duration: 800,
    });
    // Depend ONLY on the sheet-open transition. Re-running on every
    // userLocation update (watchPosition fires often) caused the camera
    // to keep snapping/easing back to the user, producing visible jumps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchStatus === 'idle' && !isSearching]);

  // Dark mode only.


  const calculateRouteInfo = (u: [number, number], w: [number, number]) => {
    const R = 6371;
    const dLat = (w[1] - u[1]) * Math.PI / 180;
    const dLon = (w[0] - u[0]) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(u[1]*Math.PI/180) * Math.cos(w[1]*Math.PI/180) * Math.sin(dLon/2)**2;
    const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return { distance, duration: Math.ceil((distance / 30) * 60) };
  };

  const animateRouteUberStyle = (coordinates: number[][]) => {
    if (!map.current) return;
    if (map.current.getSource('route')) { map.current.removeLayer('route'); map.current.removeSource('route'); }
    if (map.current.getSource('route-glow')) { map.current.removeLayer('route-glow'); map.current.removeSource('route-glow'); }
    // Save coords so a day/night toggle can re-add the layer instantly
    // without animating again.
    currentRouteCoords.current = coordinates as [number, number][];

    map.current.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
    map.current.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#31d880', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 18, 8] } });

    const total = coordinates.length;
    let cur = 0;
    const start = Date.now();
    const animate = () => {
      const progress = Math.min((Date.now() - start) / 2000, 1);
      const target = Math.floor(progress * total);
      if (target > cur) {
        cur = target;
        const slice = coordinates.slice(0, cur + 1);
        const data = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: slice } };
        if (map.current?.getSource('route')) (map.current.getSource('route') as mapboxgl.GeoJSONSource).setData(data);
      }
      if (progress < 1) requestAnimationFrame(animate); else setIsDrawingRoute(false);
    };
    requestAnimationFrame(animate);
  };

  const addRouteToMap = async (u: [number, number], w: [number, number]) => {
    if (!map.current) return;
    setIsDrawingRoute(true);
    try {
      const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/walking/${u[0]},${u[1]};${w[0]},${w[1]}?steps=true&geometries=geojson&access_token=${mapboxgl.accessToken}`);
      const json = await res.json();
      if (json.routes?.[0]) {
        const info = calculateRouteInfo(u, w);
        setRouteInfo(info);
        setTransport(pickTransportForDistance(info.distance));
        const coords = json.routes[0].geometry.coordinates as [number, number][];
        const snappedWalker = coords[coords.length - 1] as [number, number];
        if (walkerMarker.current) walkerMarker.current.setLngLat(snappedWalker);
        setWalkerLocation(snappedWalker);
        setPickupRoute([...coords].reverse());
        setIsDrawingRoute(false);
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend(u); bounds.extend(snappedWalker);
        map.current.fitBounds(bounds, {
          padding: { top: 140, bottom: 320, left: 60, right: 60 },
          duration: 2200,
          pitch: 45,
          bearing: 0,
          essential: true,
          easing: (t: number) => 1 - Math.pow(1 - t, 3),
        });
      }
    } catch {
      const info = calculateRouteInfo(u, w);
      setRouteInfo(info);
      setTransport(pickTransportForDistance(info.distance));
      setPickupRoute([w, u]);
      setIsDrawingRoute(false);
    }
  };

  const cleanupPreviousSearch = () => {
    if (walkerMarker.current) { walkerMarker.current.remove(); walkerMarker.current = null; }
    if (map.current?.getSource('route')) { map.current.removeLayer('route'); map.current.removeSource('route'); }
    if (map.current?.getSource('route-glow')) { map.current.removeLayer('route-glow'); map.current.removeSource('route-glow'); }
    currentRouteCoords.current = null;
    setRouteInfo(null); setWalkerLocation(null);
    setSessionStatus(null);
    setLiveWalkerPosition(null);
  };

  const handleSearch = async () => {
    if (!user || selectedPets.length === 0 || !userLocation) return;
    
    // Check for existing active session first
    const { data: existingSession } = await supabase
      .from('walk_sessions')
      .select('id, current_status')
      .eq('customer_id', user.id)
      .in('current_status', ['searching', 'accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning'])
      .maybeSingle();

    if (existingSession) {
      setCurrentSessionId(existingSession.id);
      setSessionStatus(existingSession.current_status as WalkStatus);
      if (existingSession.current_status === 'searching') {
        setSearchStatus('waiting');
      } else {
        setSearchStatus('walking');
      }
      return;
    }
    
    try {
      cleanupPreviousSearch();
      setIsSearching(true);
      setSearchStatus('searching');
      setSheetExpanded(false);

      if (map.current) {
        map.current.flyTo({
          center: userLocation,
          zoom: 16,
          pitch: 50,
          bearing: 0,
          speed: 0.6,
          curve: 1.4,
          essential: true,
        });
      }

      // PHASE 3: Real Walk Request creation
      let scheduledForIso = null;
      if (scheduleMode === 'later') {
        const [year, month, day] = scheduleDate.split('-').map(Number);
        const [hour, minute] = scheduleTime.split(':').map(Number);
        const localDate = new Date(year, month - 1, day, hour, minute);
        
        if (localDate <= new Date()) {
          toast.error('Agendamento deve ser para o futuro');
          setIsSearching(false);
          setSearchStatus('idle');
          return;
        }
        scheduledForIso = localDate.toISOString();
      }

      const { data: sessionId, error: rpcError } = await supabase.rpc('create_walk_request', {
        _pet_id: selectedPets[0]?.id,
        _duration_minutes: selectedMinutes,
        _request_mode: (scheduleMode === 'now' ? 'now' : 'scheduled'),
        _scheduled_for: scheduledForIso,
        _meeting_point_lng: Number(userLocation[0]),
        _meeting_point_lat: Number(userLocation[1]),
        _meeting_point_address: 'Localização atual'
      });

      if (rpcError) throw rpcError;
      
      const { data: sessionData } = await supabase
        .from('walk_sessions')
        .select('matching_expires_at')
        .eq('id', sessionId)
        .single();
      
      if (sessionData?.matching_expires_at) {
        setMatchingExpiresAt(sessionData.matching_expires_at);
      }

      setCurrentSessionId(sessionId);
      setSearchStatus('waiting');
      setIsSearching(false);

    } catch (e: unknown) {
      console.error('Error starting search:', e);
      toast.error(e instanceof Error ? e.message : 'Erro ao iniciar busca');
      setIsSearching(false);
      setSearchStatus('idle');
    }
  };

  type SessionRow = {
    id?: string;
    start_time?: string | null;
    walker_id?: string | null;
    walker_name?: string | null;
  } & Record<string, unknown>;

  const handleAccepted = useCallback(async (raw: Record<string, unknown>) => {
    const sessionData = raw as SessionRow;
    if (searchStatusRef.current === 'walking' || !user) return;

    preloadDog3DAsset().catch(() => {});
    preloadCheckpointAsset().catch(() => {});
    
    setSearchStatus('walking');
    
    sessionCreatedRef.current = true;
    if (recoveryTimeoutRef.current) {
      clearTimeout(recoveryTimeoutRef.current);
      recoveryTimeoutRef.current = null;
    }

    if (walkerMarker.current) { walkerMarker.current.remove(); walkerMarker.current = null; }
    
    const startTime = sessionData.start_time ? new Date(sessionData.start_time).getTime() : Date.now();
    setWalkStartTime(startTime);
    
    const fallbackName = sessionData.walker_name || 'Pet Walker';
    setWalker((prev) => prev ?? {
      name: fallbackName,
      firstName: String(fallbackName).split(' ')[0],
      avatar: '',
      rating: 0,
      walks: 0,
      code: ''
    });

    if (sessionData.walker_id) {
      const { data: walkerProfile, error: profileError } = await supabase
        .rpc('get_session_walker_profile', { _session_id: sessionData.id as string });
      
      if (!profileError && walkerProfile && walkerProfile.length > 0) {
        const profile = walkerProfile[0];
        setWalker({
          name: profile.full_name || 'Pet Walker',
          firstName: (profile.full_name || 'Pet Walker').split(' ')[0],
          avatar: profile.avatar_url || '',
          rating: Number(profile.rating_average || 0),
          walks: Number(profile.completed_walks || 0),
          code: ''
        });
      }
    }
  }, [user, walkerMarker, userLocation, addRouteToMap]);

  // Customer authorizes return via chat.
  const handleAuthorizeReturn = async () => {
    if (isReturning) return;
    setIsReturning(true);
    if (currentSessionId) {
      const { error } = await supabase.rpc('customer_request_return', {
        _session_id: currentSessionId
      });
      if (error) {
        console.error('Falha ao iniciar retorno:', error);
        toast.error('Erro ao solicitar retorno');
        setIsReturning(false);
      }
    }
  };

  // Arrival confirmation (final status).
  const handleConfirmArrival = async () => {
    const dur = Math.floor((Date.now() - walkStartTime) / 1000);
    setWalkDuration(dur);
    if (currentSessionId) {
      const { error } = await supabase.rpc('customer_confirm_arrival', {
        _session_id: currentSessionId
      });
      if (error) {
        console.error('Falha ao confirmar chegada:', error);
        toast.error('Erro ao confirmar chegada');
        return;
      }
    }
    setSearchStatus('reviewing');
  };
  const handleReviewComplete = () => { navigate('/'); setSearchStatus('idle'); cleanupPreviousSearch(); };
  
  const handleRequestReturn = async () => {
    const dur = Math.floor((Date.now() - walkStartTime) / 1000);
    setWalkDuration(dur);
    setSearchStatus('reviewing');
  };

  useEffect(() => {
    if (!currentSessionId) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reqSeq = 0;
    let lastAppliedSeq = 0;

    const applyStatus = (data: { current_status?: string | null; matching_expires_at?: string | null } & Record<string, unknown>, seq: number, origin: 'initial' | 'realtime' | 'recovery') => {
      // Descarta respostas antigas que chegarem depois de uma mais recente.
      if (cancelled || !data || seq < lastAppliedSeq) return;
      lastAppliedSeq = seq;
      const status = (data.current_status ?? null) as WalkStatus | null;
      if (data.matching_expires_at) setMatchingExpiresAt(data.matching_expires_at);
      // O banco é a autoridade: `sessionStatus` dirige o rastreamento;
      // `searchStatus` apenas troca a apresentação.
      setSessionStatus(status);
      console.info('[walk-status]', {
        origin,
        seq,
        sessionId: currentSessionId,
        current_status: status,
        searchStatus: searchStatusRef.current,
        trackable: isTrackableStatus(status),
      });
      if (isTrackableStatus(status) && searchStatusRef.current !== 'walking') {
        handleAccepted(data);
      } else if (status === 'expired' || status === 'cancelled') {
        handleTimeout();
      }
      // A recuperação periódica só para em estados terminais — enquanto a
      // sessão estiver rastreável mantemos a sincronia leve com o banco.
      if ((status === 'completed' || status === 'cancelled' || status === 'expired') && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const fetchStatus = async (origin: 'initial' | 'realtime' | 'recovery') => {
      const seq = ++reqSeq;
      const { data } = await supabase
        .from('walk_sessions')
        .select('*')
        .eq('id', currentSessionId)
        .maybeSingle();
      if (data) applyStatus(data, seq, origin);
    };

    const channel = supabase
      .channel(`walk-session-${currentSessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'walk_sessions',
          filter: `id=eq.${currentSessionId}`
        },
        (payload) => {
          applyStatus(payload.new as Record<string, unknown>, ++reqSeq, 'realtime');
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') fetchStatus('initial');
      });

    // Consulta imediata + recuperação periódica (independente de Realtime
    // e de qualquer estado de apresentação).
    fetchStatus('initial');
    pollTimer = setInterval(() => { fetchStatus('recovery'); }, 5000);

    // Ao voltar o foco/visibilidade, ressincroniza imediatamente.
    const onFocus = () => { fetchStatus('recovery'); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, handleAccepted]);

  /** Rastreamento derivado do domínio, NUNCA da apresentação. */
  const isTrackableSession = useMemo(
    () => !!currentSessionId && isTrackableStatus(sessionStatus),
    [currentSessionId, sessionStatus]
  );

  // Sincroniza a APRESENTAÇÃO com o domínio: se a sessão está rastreável
  // mas a UI ficou atrás (evento perdido, guarda antiga, animação), promove
  // a tela operacional. O rastreamento já roda independentemente disto.
  useEffect(() => {
    if (!isTrackableSession) return;
    if (searchStatus !== 'walking' && searchStatus !== 'reviewing') {
      setSearchStatus('walking');
    }
  }, [isTrackableSession, searchStatus]);
  
  // ────────────────────────────────────────────────────────────────
  // Posição atual do PetWalker: fonte canônica ÚNICA é a RPC segura
  // `get_active_walker_location` (autorizada pelo servidor apenas para
  // os participantes da sessão). `route_coordinates` é usado só para o
  // rastro histórico. Consulta imediata + atualização periódica,
  // com proteção contra respostas fora de ordem e sem descartar a
  // última posição válida em erro de rede.
  // ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentSessionId || !isTrackableSession) {
      console.info('[walk-tracking] polling NOT started', {
        sessionId: currentSessionId,
        sessionStatus,
        searchStatus: searchStatusRef.current,
        reason: !currentSessionId ? 'sem sessão' : 'status não rastreável',
      });
      return;
    }

    let active = true;
    let lastTs = 0;
    console.info('[walk-tracking] polling STARTED', { sessionId: currentSessionId, sessionStatus });

    const readLocation = async () => {
      const { data, error } = await supabase.rpc('get_active_walker_location', {
        _session_id: currentSessionId,
      });
      if (!active || error || !Array.isArray(data) || data.length === 0) return;
      const loc = data[0] as { lat: number | null; lng: number | null; accuracy: number | null; updated_at: string | null };
      if (typeof loc.lng !== 'number' || typeof loc.lat !== 'number') return;
      const ts = loc.updated_at ? new Date(loc.updated_at).getTime() : Date.now();
      if (ts < lastTs) return; // resposta antiga não sobrescreve a mais recente
      lastTs = ts;
      console.info('[walk-tracking] position', { lng: loc.lng, lat: loc.lat, ts });
      setLiveWalkerPosition({ lng: loc.lng, lat: loc.lat, ts });
      // Semeia a posição inicial do mapa uma única vez (sem remontá-lo depois).
      setWalkerLocation((prev) => prev ?? [loc.lng as number, loc.lat as number]);
    };

    readLocation();
    const pollInterval = setInterval(readLocation, 3000);

    return () => {
      active = false;
      clearInterval(pollInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, isTrackableSession]);
  const handleOpenChat = () => {
    // Chat implementation will use the session state
  };
  const handleRequestPhotos = () => alert('Solicitação de fotos enviada!');
  const handleTimeout = () => { cleanupPreviousSearch(); setSearchStatus('idle'); };
  const handleCancel = () => setShowCancelDialog(true);
  const handleGoHome = () => { setShowCancelDialog(false); navigate('/'); };
  const handleSearchAnother = () => { setShowCancelDialog(false); cleanupPreviousSearch(); setSearchStatus('idle'); };

  // Active walk cancellation logic.
  const [isCancellingWalk, setIsCancellingWalk] = useState(false);
  const handleCancelWalk = async () => {
    setIsCancellingWalk(true);
    await handleAuthorizeReturn();
  };
  const handleCancelComplete = async () => {
    if (currentSessionId) {
      try {
        const { error } = await supabase.rpc('customer_cancel_search', {
          _session_id: currentSessionId
        });
        if (error) throw error;
      } catch (e) {
        console.error('Falha ao cancelar solicitação:', e);
        toast.error('Erro ao cancelar solicitação');
        return; 
      }
    }
    setIsCancellingWalk(false);
    cleanupPreviousSearch();
    setSearchStatus('idle');
    setMatchingExpiresAt(null);
    setCurrentSessionId(null);
    navigate('/');
  };

  const showBottomSheet = useMemo(() => searchStatus === 'idle' && !isSearching, [searchStatus, isSearching]);
  const fullscreen = useMemo(() => !showBottomSheet, [showBottomSheet]);

  // Dark-mode UI tokens.
  const ui = useMemo(() => isDayMode
    ? {
        chip: '#FFFFFF',
        chipAlpha: 'rgba(255,255,255,0.9)',
        sheet: '#FFFFFF',
        inner: '#F7F5EF',
        innerAlpha: 'rgba(255,255,255,0.95)',
        border: '1px solid rgba(11,20,16,0.06)',
        borderSoft: '1px solid rgba(11,20,16,0.04)',
        text: '#0B1410',
        textSoft: '#0B1410',
        muted: 'rgba(11,20,16,0.5)',
        dotIdle: 'rgba(11,20,16,0.1)',
        divider: 'rgba(11,20,16,0.05)',
        pillBg: 'rgba(255,255,255,0.95)',
        shadow: '0 4px 12px rgba(11,20,16,0.08)',
        sheetShadow: '0 20px 50px rgba(11,20,16,0.12)',
        iconColor: '#0B1410',
      }
    : {
        chip: '#0B1410',
        chipAlpha: 'rgba(11,20,16,0.9)',
        sheet: '#0B1410',
        inner: 'rgba(247,245,239,0.05)',
        innerAlpha: 'rgba(11,20,16,0.95)',
        border: '1px solid rgba(247,245,239,0.08)',
        borderSoft: '1px solid rgba(247,245,239,0.04)',
        text: '#F7F5EF',
        textSoft: '#F7F5EF',
        muted: 'rgba(247,245,239,0.45)',
        dotIdle: 'rgba(247,245,239,0.12)',
        divider: 'rgba(247,245,239,0.08)',
        pillBg: '#0B1410',
        shadow: '0 8px 24px rgba(0,0,0,0.4)',
        sheetShadow: '0 25px 60px rgba(0,0,0,0.5)',
        iconColor: '#F7F5EF',
      }, [isDayMode]);

  return (
    <div
      className={`fixed inset-0 ${fullscreen ? '' : 'max-w-md mx-auto'}`}
      style={{ background: isDayMode ? '#F7F5EF' : '#0B1410' }}
    >
      {/* Map */}
      <div className="absolute inset-0">
        <div ref={mapContainer} className="w-full h-full" />
      </div>

      {/* Rain overlay (parallax + splashes). */}
      {weather && isRainCode(weather.code) && (() => {
        const rain = classifyRain(weather.code, weather.precip);
        const layers = [
          {
            key: 'far',
            count: Math.round(rain.drops * 0.45),
            widthMul: 0.6,
            heightMul: 0.7,
            speedMul: 1.45,
            opacityMul: 0.45,
            blur: 1.1,
          },
          {
            key: 'mid',
            count: Math.round(rain.drops * 0.35),
            widthMul: 1.0,
            heightMul: 1.0,
            speedMul: 1.0,
            opacityMul: 0.75,
            blur: 0.4,
          },
          {
            key: 'near',
            count: Math.round(rain.drops * 0.2),
            widthMul: 1.7,
            heightMul: 1.35,
            speedMul: 0.7,
            opacityMul: 1.0,
            blur: 0,
          },
        ];
        const splashCount = Math.round(rain.drops * 0.22);
        return (
          <div
            className="absolute inset-0 z-[5] overflow-hidden pointer-events-none"
            aria-hidden="true"
            data-rain-level={rain.level}
          >
            <style>{`
              @keyframes vp-rain-fall {
                0%   { transform: translate3d(0, -20vh, 0) rotate(-10deg); opacity: 0; }
                10%  { opacity: var(--vp-op, 0.5); }
                90%  { opacity: var(--vp-op, 0.5); }
                100% { transform: translate3d(0, 120vh, 0) rotate(-10deg); opacity: 0; }
              }
              @keyframes vp-rain-splash {
                0%   { transform: translate(-50%, -50%) scale(0.15); opacity: 0; }
                20%  { opacity: var(--vp-sop, 0.5); }
                100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
              }
              .vp-rain-drop {
                position: absolute;
                top: 0;
                border-radius: 999px;
                background: linear-gradient(
                  to bottom,
                  rgba(210, 230, 255, 0) 0%,
                  rgba(210, 230, 255, 0.35) 55%,
                  rgba(230, 240, 255, 0.75) 100%
                );
                animation: vp-rain-fall linear infinite;
                will-change: transform, opacity;
                transform: translate3d(0, -20vh, 0) rotate(-10deg);
              }
              .vp-rain-splash {
                position: absolute;
                border: 1px solid rgba(210, 230, 255, 0.6);
                border-radius: 50%;
                transform: translate(-50%, -50%) scale(0);
                animation: vp-rain-splash ease-out infinite;
                will-change: transform, opacity;
                mix-blend-mode: screen;
              }
            `}</style>

            {/* Atmosfera: haze no topo + molhado embaixo. */}
            <div
              className="absolute inset-0"
              style={{
                background: `
                  linear-gradient(180deg,
                    rgba(20,40,60,${rain.wash * 0.35}) 0%,
                    rgba(20,40,60,0) 30%,
                    rgba(20,40,60,0) 55%,
                    rgba(20,40,60,${rain.wash * 0.5}) 80%,
                    rgba(20,40,60,${rain.wash}) 100%
                  )
                `,
              }}
            />

            {/* Gotas (parallax). */}
            {layers.map((layer) => (
              <div key={layer.key} className="absolute inset-0">
                {Array.from({ length: layer.count }).map((_, i) => {
                  const left = Math.random() * 100;
                  const delay = Math.random() * 2;
                  const duration =
                    (rain.minDuration + Math.random() * (rain.maxDuration - rain.minDuration)) *
                    layer.speedMul;
                  const w = rain.dropWidth * layer.widthMul;
                  const h = rain.dropHeight * layer.heightMul;
                  const op =
                    (rain.opacityBase + Math.random() * (1 - rain.opacityBase) * 0.4) *
                    layer.opacityMul;
                  return (
                    <span
                      key={i}
                      className="vp-rain-drop"
                      style={{
                        left: `${left}%`,
                        width: `${w}px`,
                        height: `${h}px`,
                        animationDelay: `${delay}s`,
                        animationDuration: `${duration}s`,
                        filter: layer.blur ? `blur(${layer.blur}px)` : undefined,
                        ['--vp-op' as keyof React.CSSProperties]: Math.min(op, 0.8).toFixed(3),
                      } as React.CSSProperties}
                    />
                  );
                })}
              </div>
            ))}

            {/* Splashes no chão — anéis pulsando na faixa inferior. */}
            {Array.from({ length: splashCount }).map((_, i) => {
              const left = Math.random() * 100;
              const top = 70 + Math.random() * 28;
              const delay = Math.random() * 2.4;
              const duration = 0.8 + Math.random() * 0.7;
              const size = 5 + Math.random() * 11;
              const sop = Math.min(rain.opacityBase * 1.2 + 0.15, 0.7);
              return (
                <span
                  key={`s-${i}`}
                  className="vp-rain-splash"
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    width: `${size}px`,
                    height: `${size * 0.32}px`,
                    animationDelay: `${delay}s`,
                    animationDuration: `${duration}s`,
                    ['--vp-sop' as keyof React.CSSProperties]: sop.toFixed(3),
                  } as React.CSSProperties}
                />
              );
            })}
          </div>
        );
      })()}

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 px-4 pt-safe-plus-lg">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate('/')} className="w-11 h-11 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform" style={{ background: ui.chip, boxShadow: ui.shadow }}>
            <ArrowLeft className="w-5 h-5" style={{ color: ui.iconColor }} />
          </button>
          <div className="flex gap-2">
            {/* Weather chip — current temperature + condition for the user's location */}
            {(() => {
              const w = weather
                ? describeWeather(weather.code, weather.isDay)
                : { Icon: Cloud, label: 'Carregando clima' };
              const WIcon = w.Icon;
              return (
                <div
                  className="h-11 px-3.5 rounded-full shadow-lg flex items-center gap-2"
                  style={{ background: ui.chip, boxShadow: ui.shadow }}
                  aria-label={`Clima atual: ${w.label}`}
                  title={w.label}
                >
                  <WIcon className="w-5 h-5" style={{ color: weather && isRainCode(weather.code) ? '#31D880' : ui.iconColor }} strokeWidth={2.2} />
                  <span
                    className="text-[15px] font-semibold tabular-nums"
                    style={{ color: ui.text, fontFamily: 'Space Grotesk, sans-serif' }}
                  >
                    {weather ? `${weather.temp}°` : '—'}
                  </span>
                </div>
              );
            })()}
            <button onClick={() => { if (userLocation && map.current) map.current.flyTo({ center: userLocation, zoom: 15 }); }} className="w-11 h-11 rounded-full shadow-lg flex items-center justify-center" style={{ background: ui.chip, boxShadow: ui.shadow }}>
              <Navigation className="w-5 h-5" style={{ color: ui.iconColor }} />
            </button>
          </div>
        </div>
      </div>

      {/* Map zoom controls */}
      <div className="absolute right-4 top-24 z-10 flex flex-col gap-2">
        <button onClick={() => map.current?.zoomIn()} className="w-10 h-10 rounded-full shadow-lg flex items-center justify-center" style={{ background: ui.chip, boxShadow: ui.shadow }}><Plus className="w-4 h-4" style={{ color: ui.iconColor }} /></button>
        <button onClick={() => map.current?.zoomOut()} className="w-10 h-10 rounded-full shadow-lg flex items-center justify-center" style={{ background: ui.chip, boxShadow: ui.shadow }}><Minus className="w-4 h-4" style={{ color: ui.iconColor }} /></button>
      </div>

      {/* Bottom fade — always visible across every search-walk step so the
          floating controls/sheet sit on a soft gradient instead of the bare map. */}
      <div
        className="absolute left-0 right-0 bottom-0 z-20 pointer-events-none"
        style={{
          height: 'calc(180px + env(safe-area-inset-bottom))',
          background: isDayMode
            ? 'linear-gradient(to top, rgba(247,245,239,1) 0%, rgba(247,245,239,0.85) 35%, rgba(247,245,239,0) 100%)'
            : 'linear-gradient(to top, rgba(11,20,16,1) 0%, rgba(11,20,16,0.85) 35%, rgba(11,20,16,0) 100%)',
        }}
      />
      {showBottomSheet && (
        <div
          className="absolute left-3 right-3 z-30"
          style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <div
            className="rounded-[32px] overflow-hidden"
            style={{
              background: ui.sheet,
              backdropFilter: 'blur(22px)',
              WebkitBackdropFilter: 'blur(22px)',
              border: ui.border,
              boxShadow: ui.sheetShadow,
            }}
          >
            <div className="px-5 pt-4 pb-5">
              {/* Step indicator — 3 minimal dots */}
              <div className="flex items-center justify-center gap-1.5 mb-4">
                {[1, 2, 3, 4].map(n => (
                  <span
                    key={n}
                    className="h-1 rounded-full transition-all duration-300"
                    style={{
                      width: step === n ? 22 : 6,
                      background: step >= n ? '#31d880' : ui.dotIdle,
                    }}
                  />
                ))}
              </div>

              {/* STEP 1 — Quando? */}
              {step === 1 && (
                <div key="s1" className="animate-fade-in">
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-3 px-1" style={{ color: ui.muted }}>Iniciar o passeio</p>
                  <div
                    className="relative flex items-center p-1.5 mb-3 rounded-full"
                    style={{ background: ui.inner, border: ui.borderSoft, boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}
                  >
                    {/* Sliding indicator */}
                    <div
                      className="absolute top-1.5 bottom-1.5 rounded-full transition-all duration-500"
                      style={{
                       left: scheduleMode === 'now' ? '0.375rem' : 'calc(25% + 0.375rem)',
                       width: 'calc(75% - 0.75rem)',
                        background: isDayMode ? '#ffffff' : 'rgba(255,255,255,0.1)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                        transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                      }}
                    />
                    <button
                      onClick={() => setScheduleMode('now')}
                      data-testid="agora-btn"
                      aria-label="Agora"
                      className="relative z-10 flex items-center justify-center gap-2 py-3 rounded-full overflow-hidden transition-[flex-grow] duration-500"
                      style={{
                        flexGrow: scheduleMode === 'now' ? 3 : 1,
                        flexBasis: 0,
                        color: scheduleMode === 'now' ? ui.text : ui.textSoft,
                        transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                      }}
                    >
                      <PawPrint className="w-4 h-4 shrink-0" strokeWidth={2.5} />
                      <span
                        className="text-sm font-extrabold whitespace-nowrap transition-all duration-500"
                        style={{
                          maxWidth: scheduleMode === 'now' ? '120px' : '0px',
                          opacity: scheduleMode === 'now' ? 1 : 0,
                          marginLeft: scheduleMode === 'now' ? 0 : '-0.5rem',
                          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                        }}
                      >
                        Agora
                      </span>
                    </button>
                    <button
                      onClick={() => setScheduleMode('later')}
                      aria-label="Agendar"
                      className="relative z-10 flex items-center justify-center gap-2 py-3 rounded-full overflow-hidden transition-[flex-grow] duration-500"
                      style={{
                        flexGrow: scheduleMode === 'later' ? 3 : 1,
                        flexBasis: 0,
                        color: scheduleMode === 'later' ? ui.text : ui.textSoft,
                        transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                      }}
                    >
                      <CalendarIcon className="w-4 h-4 shrink-0" strokeWidth={2.5} />
                      <span
                        className="text-sm font-extrabold whitespace-nowrap transition-all duration-500"
                        style={{
                          maxWidth: scheduleMode === 'later' ? '120px' : '0px',
                          opacity: scheduleMode === 'later' ? 1 : 0,
                          marginLeft: scheduleMode === 'later' ? 0 : '-0.5rem',
                          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                        }}
                      >
                        Agendar
                      </span>
                    </button>
                  </div>

                  <div
                    className="grid transition-[grid-template-rows,opacity,margin,padding] duration-500"
                    style={{
                      gridTemplateRows: scheduleMode === 'later' ? '1fr' : '0fr',
                      opacity: scheduleMode === 'later' ? 1 : 0,
                      marginBottom: scheduleMode === 'later' ? '0.75rem' : '0',
                      paddingTop: scheduleMode === 'later' ? '0.25rem' : '0',
                      transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
                    }}
                  >
                    <div className="overflow-hidden">
                      <div className="grid grid-cols-2 gap-2">
                        <label
                          className="flex items-center gap-2 px-3 py-2.5 rounded-full shadow-sm transition-all duration-500"
                          style={{
                            background: ui.inner,
                            border: ui.borderSoft,
                            transform: scheduleMode === 'later' ? 'translateY(0)' : 'translateY(-6px)',
                            opacity: scheduleMode === 'later' ? 1 : 0,
                            transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
                            transitionDelay: scheduleMode === 'later' ? '80ms' : '0ms',
                          }}
                        >
                          <CalendarIcon className="w-4 h-4 text-[#31d880] shrink-0" />
                          <input
                            type="date"
                            value={scheduleDate}
                            min={new Date().toISOString().slice(0, 10)}
                            onChange={(e) => setScheduleDate(e.target.value)}
                            className="flex-1 bg-transparent text-sm font-semibold outline-none min-w-0"
                            style={{ color: ui.text, colorScheme: isDayMode ? 'light' : 'dark' }}
                          />
                        </label>
                        <label
                          className="flex items-center gap-2 px-3 py-2.5 rounded-full shadow-sm transition-all duration-500"
                          style={{
                            background: ui.inner,
                            border: ui.borderSoft,
                            transform: scheduleMode === 'later' ? 'translateY(0)' : 'translateY(-6px)',
                            opacity: scheduleMode === 'later' ? 1 : 0,
                            transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
                            transitionDelay: scheduleMode === 'later' ? '160ms' : '0ms',
                          }}
                        >
                          <Clock className="w-4 h-4 text-[#31d880] shrink-0" />
                          <input
                            type="time"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                            className="flex-1 bg-transparent text-sm font-semibold outline-none min-w-0"
                            style={{ color: ui.text, colorScheme: isDayMode ? 'light' : 'dark' }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="mb-4 mt-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider mb-3 px-1" style={{ color: ui.muted }}>
                      {pets.length > 0 ? "Qual pet?" : "Nenhum pet cadastrado"}
                    </p>
                    <div className="flex items-start gap-4 overflow-x-auto pb-1 px-1 -mx-1 scrollbar-none">
                      {pets.length === 0 ? (
                        <button
                          onClick={() => navigate('/add-pet')}
                          className="flex items-center gap-3 w-full p-4 rounded-2xl animate-pulse"
                          style={{ background: ui.inner, border: `1px dashed #31d88044` }}
                        >
                          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-[#31D88022]">
                            <Plus className="w-5 h-5 text-[#31D880]" />
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-bold" style={{ color: ui.text }}>Cadastre um pet</p>
                            <p className="text-[11px]" style={{ color: ui.muted }}>Você precisa de um pet para passear</p>
                          </div>
                        </button>
                      ) : (
                        pets.map((p) => {
                          const active = selectedPets.some(sp => sp.id === p.id);
                          return (
                            <button
                              key={p.id}
                              data-testid="pet-selection-card"
                              onClick={() => {
                                const willBeCollective = !selectedPets.some(sp => sp.id === p.id) && selectedPets.length >= 1;
                                const nonEligible = ['agressivo', 'protetor', 'moderavel'];
                                
                                if (willBeCollective) {
                                  const hasIncompatibleSelected = selectedPets.some(sp => nonEligible.includes(sp.behavioral_notes || ''));
                                  const isNewPetIncompatible = nonEligible.includes(p.behavioral_notes || '');
                                  
                                  if (hasIncompatibleSelected || isNewPetIncompatible) {
                                    alert(`Passeios COLETIVOS são permitidos apenas para pets com comportamento leve. Um dos pets selecionados possui comportamento não elegível.`);
                                    return;
                                  }
                                }
                                
                                setSelectedPets(prev => {
                                  const exists = prev.some(sp => sp.id === p.id);
                                  if (exists) return prev.filter(sp => sp.id !== p.id);
                                  return [...prev, p];
                                });
                              }}
                              className="flex flex-col items-center gap-1.5 shrink-0 active:scale-95 transition-transform"
                            >
                              <div className="relative">
                                <div
                                  className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center transition-all"
                                  style={{
                                    background: ui.inner,
                                    border: active ? '2.5px solid #31d880' : `2.5px solid ${isDayMode ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'}`,
                                    opacity: active || selectedPets.length === 0 ? 1 : (selectedPets.length > 0 ? 0.4 : 0.55),
                                  }}
                                >
                                  {p.avatar_url ? (
                                    <img src={p.avatar_url} alt={p.name} className="w-full h-full object-cover" />
                                  ) : (
                                    <PawPrint className="w-5 h-5" style={{ color: ui.muted }} />
                                  )}
                                </div>
                                {active && (
                                  <div
                                    className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                                    style={{ background: '#31d880', border: `2px solid ${isDayMode ? '#fff' : '#0b0b0b'}` }}
                                  >
                                    <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  </div>
                                )}
                              </div>
                              <span
                                className="text-[11px] font-semibold max-w-[60px] truncate"
                                style={{ color: active ? ui.text : ui.textSoft }}
                              >
                                {p.name}
                              </span>
                            </button>
                          );
                        })
                      )}

                        {/* Add pet */}
                        {pets.length > 0 && (
                          <button
                            onClick={() => navigate('/add-pet')}
                            className="flex flex-col items-center gap-1.5 shrink-0 active:scale-95 transition-transform"
                            aria-label="Adicionar pet"
                          >
                            <div
                              className="w-14 h-14 rounded-full flex items-center justify-center"
                              style={{
                                background: ui.inner,
                                border: `2px dashed ${isDayMode ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.22)'}`,
                              }}
                            >
                              <Plus className="w-5 h-5" style={{ color: ui.muted }} strokeWidth={2.5} />
                            </div>
                            <span className="text-[11px] font-semibold" style={{ color: ui.muted }}>Novo</span>
                          </button>
                        )}
                      </div>
                    </div>

                  <button
                    data-testid="confirm-pet-selection"
                    onClick={() => { if (selectedPets.length > 0) setStep(2); }}
                    disabled={selectedPets.length === 0}
                    className="w-full py-3.5 rounded-full text-white font-extrabold text-sm transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: '#31d880', boxShadow: selectedPets.length > 0 ? '0 10px 24px rgba(49,216,128,0.35)' : 'none' }}
                  >
                    {pets.length === 0 ? 'Cadastre um pet primeiro' : (selectedPets.length > 0 ? 'Continuar' : 'Selecione pelo menos um pet')}
                  </button>
                </div>
              )}

              {/* STEP 3 — Duração (mostrada APÓS escolher o tipo de passeio) */}
              {step === 3 && (
                <div key="s2" className="animate-fade-in">
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-3 px-1" style={{ color: ui.muted }}>Duração</p>
                  <div
                    className="flex items-center justify-between mb-4 rounded-3xl px-3 py-3"
                    style={{ background: ui.inner, border: ui.borderSoft, boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}
                  >
                    <button
                      onClick={() => setSelectedMinutes((m) => Math.max(15, m - 15))}
                      disabled={selectedMinutes <= 15}
                      className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
                      style={{ background: '#31d880', boxShadow: '0 6px 16px rgba(49,216,128,0.35)' }}
                      aria-label="Diminuir duração"
                    >
                      <Minus className="w-5 h-5 text-white" strokeWidth={3} />
                    </button>

                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-extrabold leading-none" style={{ color: ui.text }}>
                        {selectedMinutes}
                      </span>
                      <span className="text-sm font-semibold" style={{ color: ui.muted }}>
                        Min
                      </span>
                    </div>

                    <button
                      onClick={() => setSelectedMinutes((m) => m + 15)}
                      className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90"
                      style={{ background: '#31d880', boxShadow: '0 6px 16px rgba(49,216,128,0.35)' }}
                      aria-label="Aumentar duração"
                    >
                      <Plus className="w-5 h-5 text-white" strokeWidth={3} />
                    </button>
                  </div>

                  <p className="text-center text-sm font-extrabold mb-4" style={{ color: '#31d880' }}>
                    {quoteLoading
                      ? 'Calculando…'
                      : quote
                        ? Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(quote.total_price_cents / 100)
                        : (quoteError ?? '—')}
                    {quote && (
                      <span className="ml-1.5 text-[11px] font-semibold" style={{ color: ui.muted }}>
                        ({Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(quote.price_per_minute_cents / 100)}/min)
                      </span>
                    )}
                  </p>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setStep(2)}
                      className="px-5 py-3.5 rounded-full text-sm font-bold active:scale-[0.98] transition-all"
                      style={{ background: ui.inner, border: ui.borderSoft, color: ui.text }}
                    >
                      Voltar
                    </button>
                    <button
                      data-testid="confirm-duration"
                      onClick={() => setStep(4)}
                      className="flex-1 py-3.5 rounded-full text-white font-extrabold text-sm transition-all active:scale-[0.98]"
                      style={{ background: '#31d880', boxShadow: '0 10px 24px rgba(49,216,128,0.35)' }}
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2 — Tipo de passeio (escolhido ANTES da duração) */}
              {step === 2 && (() => {
                const isCollective = selectedPets.length > 1;
                const types: Array<{
                  id: 'livre' | 'local';
                  label: string;
                  Icon: LucideIcon;
                  desc: string;
                }> = [
                  { id: 'livre', label: isCollective ? 'Coletivo' : 'Livre', Icon: Sparkles, desc: isCollective ? 'Passeio com múltiplos pets selecionados.' : 'O petwalker decide tudo sobre o passeio.' },
                  { id: 'local', label: 'Local', Icon: MapIcon, desc: 'Você define locais e rotas específicas.' },
                ];
                return (
                <div key="s3" className="animate-fade-in">
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-3 px-1" style={{ color: ui.muted }}>Tipo de passeio</p>

                  <div
                    className="relative flex items-center p-1.5 mb-3 rounded-full"
                    style={{ background: ui.inner, border: ui.borderSoft, boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}
                  >
                    {/* Sliding indicator — 2 options, 50% each */}
                    <div
                      className="absolute top-1.5 bottom-1.5 rounded-full transition-all duration-500"
                      style={{
                        left: types.findIndex(t => t.id === walkType) === 0 ? '0.375rem' : 'calc(50% + 0.375rem)',
                        width: 'calc(50% - 0.75rem)',
                        background: '#31d880',
                        boxShadow: '0 4px 14px rgba(49,216,128,0.45)',
                        transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                      }}
                    />
                    {types.map((t) => {
                      const active = walkType === t.id;
                      const Icon = t.Icon;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setWalkType(t.id)}
                          aria-label={t.label}
                          className="relative z-10 flex-1 flex items-center justify-center gap-2 py-3 rounded-full overflow-hidden transition-colors duration-300"
                          style={{
                            color: active ? '#ffffff' : ui.textSoft,
                          }}
                        >
                          <Icon className="w-4 h-4 shrink-0" strokeWidth={2.5} />
                          <span className="text-sm font-extrabold whitespace-nowrap">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Expanding address search for Local */}
                  <div
                    className="grid transition-[grid-template-rows,opacity,margin] duration-500"
                    style={{
                      gridTemplateRows: walkType === 'local' ? '1fr' : '0fr',
                      opacity: walkType === 'local' ? 1 : 0,
                      marginBottom: walkType === 'local' ? '0.75rem' : '0',
                      transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
                    }}
                  >
                    <div className="overflow-hidden">
                      {/* Selected stops */}
                      {localStops.length > 0 && (
                        <div className="flex flex-col gap-2 mb-2">
                          {localStops.map((s, i) => (
                            <div
                              key={s.id}
                              draggable
                              onDragStart={(e) => {
                                dragIndexRef.current = i;
                                e.dataTransfer.effectAllowed = 'move';
                                try { e.dataTransfer.setData('text/plain', String(i)); } catch (err) { console.error('Drag data error:', err); }
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                if (dragOverIndex !== i) setDragOverIndex(i);
                              }}
                              onDragLeave={() => {
                                if (dragOverIndex === i) setDragOverIndex(null);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                const from = dragIndexRef.current;
                                dragIndexRef.current = null;
                                setDragOverIndex(null);
                                if (from === null || from === i) return;
                                setLocalStops((prev) => {
                                  const next = [...prev];
                                  const [moved] = next.splice(from, 1);
                                  next.splice(i, 0, moved);
                                  return next;
                                });
                              }}
                              onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null); }}
                              className="flex items-center gap-2 px-3 py-2 rounded-2xl animate-fade-in cursor-grab active:cursor-grabbing select-none transition-all"
                              style={{
                                background: ui.inner,
                                border: ui.borderSoft,
                                transform: dragOverIndex === i ? 'scale(1.02)' : 'scale(1)',
                                boxShadow: dragOverIndex === i ? '0 6px 18px rgba(0,0,0,0.15)' : 'none',
                              }}
                            >
                              <div
                                className="shrink-0 flex items-center justify-center -ml-1"
                                style={{ color: ui.muted, touchAction: 'none' }}
                                aria-hidden
                              >
                                <GripVertical className="w-4 h-4" />
                              </div>
                              <div
                                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-extrabold shrink-0 text-white"
                                style={{ background: '#31d880' }}
                              >
                                {i + 1}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-extrabold truncate" style={{ color: ui.text }}>{s.label}</p>
                                <p className="text-[11px] font-semibold truncate" style={{ color: ui.muted }}>{s.address}</p>
                              </div>
                              <button
                                onClick={() => setLocalStops((prev) => prev.filter((x) => x.id !== s.id))}
                                className="w-7 h-7 rounded-full flex items-center justify-center active:scale-95"
                                style={{ background: ui.divider, color: ui.text }}
                                aria-label="Remover"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Address search input */}
                      <div
                        className="flex items-center gap-2 px-3 py-2.5 rounded-full"
                        style={{ background: ui.inner, border: ui.borderSoft }}
                      >
                        {addrLoading ? (
                          <Loader2 className="w-4 h-4 shrink-0 animate-spin" style={{ color: ui.muted }} />
                        ) : (
                          <Search className="w-4 h-4 shrink-0" style={{ color: ui.muted }} />
                        )}
                        <input
                          value={addrQuery}
                          onChange={(e) => setAddrQuery(e.target.value)}
                          placeholder="Buscar endereço ou local..."
                          className="flex-1 bg-transparent outline-none text-sm font-semibold"
                          style={{ color: ui.text }}
                        />
                        {addrQuery && (
                          <button onClick={() => { setAddrQuery(''); setAddrSuggestions([]); }} className="shrink-0">
                            <X className="w-4 h-4" style={{ color: ui.muted }} />
                          </button>
                        )}
                      </div>

                      {/* Suggestions */}
                      {addrSuggestions.length > 0 && (
                        <div
                          className="mt-2 rounded-2xl overflow-hidden animate-fade-in"
                          style={{ background: ui.inner, border: ui.borderSoft }}
                        >
                          {addrSuggestions.map((s, idx) => (
                            <button
                              key={s.id}
                              onClick={() => {
                                setLocalStops((prev) => [
                                  ...prev,
                                  { id: s.id, label: s.text, address: s.place_name, lng: s.center[0], lat: s.center[1] },
                                ]);
                                setAddrQuery('');
                                setAddrSuggestions([]);
                              }}
                              className="w-full text-left px-4 py-3 flex items-start gap-2 active:opacity-70"
                              style={{ borderTop: idx > 0 ? `1px solid ${ui.divider}` : undefined }}
                            >
                              <MapPin className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#31d880' }} />
                              <div className="min-w-0">
                                <p className="text-sm font-extrabold truncate" style={{ color: ui.text }}>{s.text}</p>
                                <p className="text-[11px] font-semibold truncate" style={{ color: ui.muted }}>{s.place_name}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {plannedRouteInfo && localStops.length > 0 && (
                        <p className="mt-2 text-[11px] font-bold uppercase tracking-wider px-1" style={{ color: ui.muted }}>
                          Rota: {(plannedRouteInfo.distance / 1000).toFixed(1)} km · ~{Math.round(plannedRouteInfo.duration / 60)} min
                        </p>
                      )}
                    </div>
                    </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setStep(1)}
                      className="px-5 py-3.5 rounded-full text-sm font-bold active:scale-[0.98] transition-all"
                      style={{ background: ui.inner, border: ui.borderSoft, color: ui.text }}
                    >
                      Voltar
                    </button>
                    <button
                      data-testid="confirm-walk-type"
                      onClick={() => setStep(3)}
                      disabled={walkType === 'local' && localStops.length === 0}
                      className="flex-1 py-3.5 rounded-full text-white font-extrabold text-sm transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: '#31d880', boxShadow: '0 10px 24px rgba(49,216,128,0.35)' }}
                    >
                      Continuar
                    </button>
                  </div>
                </div>
                );
              })()}

              {/* STEP 4 — Confirmar */}
              {step === 4 && (
                <div key="s4" className="animate-fade-in">
                  <div className="flex items-center justify-between mb-3 px-1">
                    <div className="flex flex-col">
                      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: ui.muted }}>Confirmar passeio de</p>
                      <p className="text-base font-extrabold leading-tight" style={{ color: ui.text }}>
                        {selectedPets.length === 1 ? selectedPets[0].name : `${selectedPets.length} pets`}
                      </p>
                    </div>
                    <button
                      onClick={() => setStep(3)}
                      className="text-[11px] font-bold uppercase tracking-wider active:scale-95 transition-transform"
                      style={{ color: ui.muted }}
                    >
                      Voltar
                    </button>
                  </div>
                  <div className="rounded-2xl shadow-sm mb-4" style={{ background: ui.inner, border: ui.borderSoft }}>
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-xs font-semibold" style={{ color: ui.muted }}>Tipo</span>
                      <span className="text-sm font-extrabold" style={{ color: ui.text }}>
                        {walkType === 'local' ? 'Passeio por locais' : 'Passeio livre'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: `1px solid ${ui.divider}` }}>
                      <span className="text-xs font-semibold" style={{ color: ui.muted }}>Duração</span>
                      <span className="text-sm font-extrabold" style={{ color: ui.text }}>
                        {selectedMinutes >= 60 && selectedMinutes % 60 === 0
                          ? `${selectedMinutes / 60}h`
                          : selectedMinutes >= 60
                            ? `${Math.floor(selectedMinutes / 60)}h${selectedMinutes % 60}`
                            : `${selectedMinutes}min`}
                      </span>
                    </div>
                    {walkType === 'local' && localStops.length > 0 && (
                      <div className="px-4 py-3" style={{ borderTop: `1px solid ${ui.divider}` }}>
                        <p className="text-xs font-semibold mb-2" style={{ color: ui.muted }}>Endereços</p>
                        <div className="flex flex-col gap-1.5">
                          {localStops.map((s, i) => (
                            <div key={s.id} className="flex items-start gap-2">
                              <div
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0 text-white"
                                style={{ background: '#31d880' }}
                              >{i + 1}</div>
                              <p className="text-xs font-bold leading-snug" style={{ color: ui.text }}>{s.address || s.label}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: `1px solid ${ui.divider}` }}>
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold" style={{ color: ui.muted }}>Total</span>
                        {quoteError && <span className="text-[10px] text-red-500">{quoteError}</span>}
                      </div>
                      <span className="text-base font-extrabold text-[#31d880]">
                        {quoteLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : quote ? (
                          Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(quote.total_price_cents / 100)
                        ) : (
                          '—'
                        )}
                      </span>
                    </div>
                  </div>

                  <SlideToConfirm
                    label={
                      pets.length === 0 
                        ? 'Cadastre um pet para começar' 
                        : selectedPets.length === 0 
                        ? 'Selecione um pet' 

                        : scheduleMode === 'now' 
                        ? 'Arraste para buscar passeio' 
                        : 'Arraste para confirmar'
                    }
                    onConfirm={handleSearch}
                    isDarkMode={!isDayMode}
                    petAvatar={selectedPets[0]?.avatar_url}
                    petAvatars={selectedPets.map(p => p.avatar_url)}
                    petName={selectedPets.length === 1 ? selectedPets[0].name : `${selectedPets.length} pets`}
                    disabled={selectedPets.length === 0 || quoteLoading || !!quoteError || !quote}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating status pill. */}
      {isSearching && (
        <div
          className="absolute left-1/2 z-30 animate-pill-in"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)', transform: 'translateX(-50%)' }}
        >
          <div
            className="flex items-center gap-3.5 backdrop-blur-md rounded-full pl-2.5 pr-6 py-2.5 shadow-2xl transition-[width,padding] duration-500 ease-out min-w-[260px]"
            style={{ background: ui.pillBg, border: ui.border }}
          >
            <div key={searchStatus} className="flex items-center gap-3.5 animate-pill-content-in">
              {searchStatus === 'found' ? (
                <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#31d880]">
                  <img src={walker?.avatar} alt={walker?.firstName} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="relative w-12 h-12 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-2 border-[#31d880]/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#31d880] animate-spin" style={{ animationDuration: '1.1s' }} />
                  <PawPrint className="w-5 h-5 text-[#31d880]" />
                </div>
              )}
              <div className="flex flex-col leading-tight pr-2">
                <span className="text-[12px] font-semibold" style={{ color: ui.muted }}>
                  {searchStatus === 'found' ? 'Encontrado' : 'Buscando'}
                </span>
                <span className="text-[15px] font-extrabold whitespace-nowrap" style={{ color: ui.text }}>
                  {searchStatus === 'found' ? (walker?.firstName ?? 'Pet Walker') : 'Procurando passeador…'}
                </span>
              </div>
            </div>
            <button
              onClick={handleCancel}
              className="ml-auto w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-all shrink-0"
              style={{ background: isDayMode ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)' }}
              aria-label="Cancelar"
            >
              <X className="w-[18px] h-[18px]" style={{ color: ui.text }} />
            </button>
          </div>
        </div>
      )}

      {/* Route Info */}
      <RouteInfo duration={routeInfo?.duration || 0} distance={routeInfo?.distance || 0} isVisible={searchStatus === 'accepted' && routeInfo !== null && !isDrawingRoute} />

      {/* Waiting */}
      {searchStatus === 'waiting' && (
        <WaitingForAcceptance
          onTimeout={handleTimeout}
          onCancel={handleCancel}
          isDarkMode={!mapIsDay}
          userLocation={userLocation}
          walkerData={walker ? {
            name: walker.name,
            avatar_url: walker.avatar || walker.avatar_url || '',
            rating: walker.rating,
            completed_walks: walker.walks || walker.completed_walks || 0
          } : null}
        />
      )}

      {/* Walking */}
      {searchStatus === 'walking' && (
        <WalkInProgress
          onBack={handleConfirmArrival}
          onRequestReturn={handleRequestReturn}
          onOpenChat={handleOpenChat}
          onRequestPhotos={handleRequestPhotos}
          onConfirmArrival={handleConfirmArrival}
          onCancelWalk={handleCancelWalk}
          onCancelComplete={handleCancelComplete}
          isCancelling={isCancellingWalk}
          petId={selectedPets[0]?.id || ''}
          petName={selectedPets.length === 1 ? selectedPets[0].name : `${selectedPets.length} pets`}
          petAvatar={selectedPets[0]?.avatar_url}
          walkerName={walker?.firstName ?? 'Pet Walker'}
          walkerAvatar={walker?.avatar}
          walkerLocation={walkerLocation}
          livePosition={liveWalkerPosition}
          petLocation={userLocation}
          pickupRoute={pickupRoute}
          isComing={!isResuming}
          walkDurationMinutes={selectedMinutes}
          walkStartTime={new Date(walkStartTime)}
          sessionId={currentSessionId || undefined}
          isDarkMode={!mapIsDay}
          isReturning={isReturning}
          onAuthorizeReturn={handleAuthorizeReturn}
          transport={transport ?? undefined}
          walkerCode={walker?.code ?? ''}
          walkType={walkType}
          localStops={localStops.map(s => ({ lng: s.lng, lat: s.lat, label: s.label }))}
        />
      )}

      {/* Review */}
      {searchStatus === 'reviewing' && (
        <ReviewWalk onBack={() => setSearchStatus('walking')} onComplete={handleReviewComplete} petName={selectedPets.length === 1 ? selectedPets[0].name : `${selectedPets.length} pets`} walkerName={walker?.firstName ?? 'Pet Walker'} walkDuration={walkDuration} isDarkMode={!isDayMode} sessionId={currentSessionId || undefined} />
      )}

      {/* Cancel Dialog */}
      <CancelWalkDialog isOpen={showCancelDialog} onClose={() => setShowCancelDialog(false)} onGoHome={handleGoHome} onSearchAnother={handleSearchAnother} />

      {/* Navbar */}
      {showBottomSheet ? null : null}
    </div>
  );
};

export default SearchWalk;
