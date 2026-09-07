/**
 * VERIFICAÃ‡ÃƒO VISUAL:
 * - SeÃ§Ã£o "Atividade recente": CabeÃ§alho com fonte Space Grotesk 24px, botÃ£o "Ver tudo" em formato pill BRAND.
 * - Empty State: Card INK sÃ³lido com Ã­cone Activity em BRAND e radius 28px.
 * - Quick Tiles (PetShop/Vet): Radius 28px, sombras suaves, Ã­cones em containers arredondados 20px.
 * - KPIs: DistÃ¢ncia e Tempo removidos da homepage.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Clock,
  MapPin,
  Plus,
  Activity,
  ShoppingBag,
  Stethoscope,
  Sun,
  Moon,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudFog,
  CloudLightning,
  CloudSun,
  Flame,
  TrendingUp,
  Timer,
  Route,
  ShieldAlert,
  Settings,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { motion } from 'framer-motion';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    }
  }
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { duration: 0.5 }
  }
};


// Editorial palette â€” chosen direction (light + dark variants).
const BRAND = '#31D880';
const BRAND_DEEP = '#1FB368';

const MAPBOX_TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN;

interface Pet {
  id: string;
  name: string;
  breed: string | null;
  avatar_url: string | null;
}
interface LastWalk {
  id: string;
  start_time: string | null;
  actual_duration_minutes: number | null;
  planned_duration_minutes: number | null;
  distance_km: number | null;
  walker_name: string | null;
  pets: { name: string; avatar_url: string | null } | null;
}
interface UserLocation {
  latitude: number;
  longitude: number;
  name: string;
  address: string | null;
  city: string | null;
}

const slugify = (n: string) =>
  n.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

const fmtDate = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'ontem';
  if (diff < 7) return `hÃ¡ ${diff}d`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

// Map Open-Meteo WMO weather codes â†’ icon + walk-friendly label (pt-BR).
const describeWeather = (code: number, isDay: boolean) => {
  if (code === 0)
    return {
      Icon: isDay ? Sun : Moon,
      label: isDay ? 'Dia bom pra passear' : 'Noite limpa',
    };
  if ([1, 2].includes(code))
    return { Icon: CloudSun, label: 'Parcialmente nublado' };
  if (code === 3) return { Icon: Cloud, label: 'Tempo nublado' };
  if ([45, 48].includes(code)) return { Icon: CloudFog, label: 'Neblina lÃ¡ fora' };
  if ([51, 53, 55, 56, 57].includes(code))
    return { Icon: CloudRain, label: 'Garoa fina' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return { Icon: CloudRain, label: 'Chuva â€” leve o capuz' };
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return { Icon: CloudSnow, label: 'Neve por aÃ­' };
  if ([95, 96, 99].includes(code))
    return { Icon: CloudLightning, label: 'Tempestade â€” adie o passeio' };
  return { Icon: Cloud, label: 'Tempo estÃ¡vel' };
};

export const HomePasseio: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [pets, setPets] = useState<Pet[]>([]);
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [lastWalk, setLastWalk] = useState<LastWalk | null>(null);
  const [stats, setStats] = useState({ count: 0, minutes: 0, km: 0 });
  const [weekDone, setWeekDone] = useState(0);
  const [weekDaysDone, setWeekDaysDone] = useState<boolean[]>(new Array(7).fill(false));
  const WEEK_GOAL = 7;
  const [loc, setLoc] = useState<UserLocation | null>(null);
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const [neighborhood, setNeighborhood] = useState<string | null>(null);
  const [weather, setWeather] = useState<{
    temp: number;
    code: number;
    isDay: boolean;
  } | null>(null);
  const { theme, toggle, palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;

  useEffect(() => {
    if (!user) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      const [petsRes, walksRes, locRes, profRes] = await Promise.all([
        supabase
          .from('pets')
          .select('id, name, breed, avatar_url')
          .eq('owner_id', user.id)
          .eq('is_active', true),
        supabase
          .from('walk_sessions')
          .select(
            'id, start_time, actual_duration_minutes, planned_duration_minutes, distance_km, walker_name, pets:pet_id(name, avatar_url)'
          )
          .eq('customer_id', user.id)
          .eq('current_status', 'completed')
          .order('start_time', { ascending: false })
          .limit(20),
        supabase
          .from('locations')
          .select('name, address, city, latitude, longitude, is_default')
          .eq('user_id', user.id)
          .order('is_default', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('profiles')
          .select('avatar_url')
          .eq('id', user.id)
          .maybeSingle(),
      ]);
      if (cancel) return;
      const ps = (petsRes.data || []) as Pet[];
      setPets(ps);
      setSelectedPetId(ps[0]?.id ?? null);
      const ws = (walksRes.data || []) as unknown as LastWalk[];
      setLastWalk(ws[0] ?? null);
      setStats({
        count: ws.length,
        minutes: ws.reduce(
          (a, w) =>
            a + (w.actual_duration_minutes || w.planned_duration_minutes || 0),
          0
        ),
        km: ws.reduce((a, w) => a + (Number(w.distance_km) || 0), 0),
      });
      // Weekly goal: count walks since Monday 00:00 (local) â€” resets every Monday.
      const now = new Date();
      const dow = (now.getDay() + 6) % 7; // Mon=0..Sun=6
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow).getTime();
      
      const currentWeekWalks = ws.filter((w) => {
        const t = w.start_time ? new Date(w.start_time).getTime() : 0;
        return t >= weekStart;
      });

      setWeekDone(currentWeekWalks.length);

      // Map which specific days had walks
      const days = new Array(7).fill(false);
      currentWeekWalks.forEach(w => {
        if (w.start_time) {
          const d = new Date(w.start_time);
          const dayIdx = (d.getDay() + 6) % 7; // Mon=0..Sun=6
          if (dayIdx >= 0 && dayIdx < 7) {
            days[dayIdx] = true;
          }
        }
      });
      setWeekDaysDone(days);
      const l = locRes.data as any;
      if (l?.latitude && l?.longitude) {
        setLoc({
          latitude: Number(l.latitude),
          longitude: Number(l.longitude),
          name: l.name,
          address: l.address,
          city: l.city,
        });
      }
      const prof = profRes.data as any;
      if (prof?.avatar_url) setProfileAvatar(prof.avatar_url);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [user]);

  // Reverse-geocode neighborhood via Mapbox.
  useEffect(() => {
    if (!loc) return;
    let cancel = false;
    (async () => {
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${loc.longitude},${loc.latitude}.json?access_token=${MAPBOX_TOKEN}&language=pt&types=neighborhood,locality,place`;
        const r = await fetch(url);
        const j = await r.json();
        if (cancel) return;
        const f = j?.features?.[0];
        if (f?.text) setNeighborhood(f.text);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [loc]);

  // Fetch current weather for the user's location (Open-Meteo, no key).
  useEffect(() => {
    if (!loc) return;
    let cancel = false;
    (async () => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code,is_day&timezone=auto`;
        const r = await fetch(url);
        const j = await r.json();
        if (cancel) return;
        const c = j?.current;
        if (typeof c?.temperature_2m === 'number') {
          setWeather({
            temp: Math.round(c.temperature_2m),
            code: Number(c.weather_code ?? 0),
            isDay: Number(c.is_day ?? 1) === 1,
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [loc]);

  const selectedPet = useMemo(
    () => pets.find((p) => p.id === selectedPetId) || pets[0] || null,
    [pets, selectedPetId]
  );

  const startWalk = () => {
    if (selectedPet) navigate(`/search-walk?petId=${selectedPet.id}`);
    else navigate('/search-walk');
  };

  const mapIsDay = weather ? weather.isDay : theme === 'light';
  const mapStyle = mapIsDay ? 'light-v11' : 'dark-v11';
  const mapImageFilter = !mapIsDay
    ? 'grayscale(1) brightness(0.78) contrast(1.05)'
    : 'grayscale(1) contrast(1.02) brightness(1.02)';
  const mapToneOverlay = !mapIsDay
    ? 'linear-gradient(180deg, rgba(11,20,16,0.42) 0%, rgba(11,20,16,0.22) 42%, rgba(11,20,16,0.72) 100%)'
    : 'linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.75) 100%)';
  const mapBaseColor = !mapIsDay ? PAPER : INK;
  const mapLineColor = !mapIsDay ? INK : PAPER;
  const missingLocationOverlay = !mapIsDay ? `${PAPER}B8` : `${INK}66`;
  const mapUrl = loc
    ? `https://api.mapbox.com/styles/v1/mapbox/${mapStyle}/static/${loc.longitude},${loc.latitude},15.6,0,0/720x540@2x?access_token=${MAPBOX_TOKEN}&attribution=false&logo=false`
    : null;

  const [locRequesting, setLocRequesting] = useState(false);
  const [locDenied, setLocDenied] = useState(false);
  const [showLocBlockedModal, setShowLocBlockedModal] = useState(false);

  const requestLocation = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!('geolocation' in navigator)) { 
      setLocDenied(true); 
      setShowLocBlockedModal(true); 
      return; 
    }
    
    setLocRequesting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          name: 'Minha localizaÃ§Ã£o',
          address: null,
          city: null,
        });
        setLocRequesting(false);
        setLocDenied(false);
        setShowLocBlockedModal(false);
      },
      (err) => { 
        console.error('Geolocation error:', err);
        setLocDenied(true); 
        setLocRequesting(false);
        setShowLocBlockedModal(true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  useEffect(() => {
    // Initial request
    requestLocation();

    // Monitor permission changes
    if ('permissions' in navigator) {
      navigator.permissions.query({ name: 'geolocation' as PermissionName }).then((status) => {
        if (status.state === 'denied') {
          setLocDenied(true);
          setShowLocBlockedModal(true);
        }
        
        status.onchange = () => {
          if (status.state === 'denied') {
            setLocDenied(true);
            setShowLocBlockedModal(true);
          } else if (status.state === 'granted') {
            setLocDenied(false);
            setShowLocBlockedModal(false);
            requestLocation();
          }
        };
      });
    }
  }, []);


  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="min-h-screen pb-10"
      style={{ background: PAPER, color: INK }}
    >
      <div className="px-4 pt-2 pb-2 space-y-6">
        {loading ? (
          <HomeSkeleton paper={PAPER} ink={INK} />
        ) : (
          <>
        {/* ============ EDITORIAL HEADLINE ============ */}
        <motion.section variants={itemVariants} className="flex items-end justify-between">
          <div>
            <h1
              className="font-bold leading-[0.9] -ml-0.5"
              style={{
                fontSize: '34px',
                letterSpacing: '-0.02em',
                lineHeight: '1.1'
              }}
            >
              Bora<br />
              passear?
            </h1>
          </div>
          <div className="flex items-end gap-2 pb-1">
            <button
              onClick={toggle}
              aria-label="Alternar tema"
              className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{ border: `1px solid ${INK}26`, color: INK }}
            >
              {theme === 'light' ? (
                <Moon className="w-4 h-4" strokeWidth={2} />
              ) : (
                <Sun className="w-4 h-4" strokeWidth={2} />
              )}
            </button>
            <button
              id="tour-history"
              onClick={() => navigate('/historico')}
              className="flex flex-col items-end active:scale-95 transition-transform"
            >
              <span
                className="text-[9px] font-bold uppercase tracking-[0.24em]"
                style={{ opacity: 0.55 }}
              >
                Passeios
              </span>
              <span
                className="font-bold mt-0.5"
                style={{
                  fontSize: 22,
                  letterSpacing: '-0.02em',
                }}
              >
                {String(stats.count).padStart(2, '0')}
              </span>
            </button>
          </div>
        </motion.section>

        {/* ============ PET CHIPS ============ */}
        <motion.section id="tour-pet-chips" variants={itemVariants} className="-mx-5 px-5 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {pets.map((pet) => {
            const active = pet.id === selectedPet?.id;
            return (
              <button
                key={pet.id}
                onClick={() => {
                  setSelectedPetId(pet.id);
                  navigate(`/pet/${slugify(pet.name)}`);
                }}
                className="flex-shrink-0 flex items-center gap-2 pr-3 pl-1 py-1 rounded-full transition-all active:scale-95"
                style={{
                  background: active ? INK : 'transparent',
                  color: active ? PAPER : INK,
                  border: `1px solid ${active ? INK : `${INK}2E`}`,
                }}
              >
                <div className="w-7 h-7 rounded-full overflow-hidden bg-black/5 flex-shrink-0">
                  {pet.avatar_url ? (
                    <img
                      src={pet.avatar_url}
                      alt={pet.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[11px] font-bold">
                      {pet.name.charAt(0)}
                    </div>
                  )}
                </div>
                <span
                  className="text-ios-subheadline font-semibold pr-0.5"
                >
                  {pet.name}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => navigate('/add-pet')}
            className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{ border: `1px dashed ${INK}4D` }}
            aria-label="Adicionar pet"
          >
            <Plus className="w-4 h-4" style={{ color: INK, opacity: 0.6 }} />
          </button>
        </motion.section>

        {/* ============ HERO: MAP + CTA (hero-grid) ============ */}
        <motion.section
          id="tour-start-walk"
          variants={itemVariants}
          onClick={startWalk}
          className="relative overflow-hidden cursor-pointer active:scale-[0.995] transition-transform"
          style={{
            borderRadius: 28,
            background: mapBaseColor,
            aspectRatio: '4/4.2',
          }}
        >
          {/* Map */}
          {mapUrl ? (
            <img
              src={mapUrl}
              alt="Seu bairro"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: mapImageFilter }}
            />
          ) : (
            <>
              <MapFallback background={mapBaseColor} line={mapLineColor} />
              <div
                className="absolute inset-0"
                style={{ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', background: missingLocationOverlay }}
              />
            </>
          )}

          {/* Grid overlay */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 400 420"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <pattern
                id="g"
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 40 0 L 0 0 0 40"
                  fill="none"
                  stroke={INK}
                  strokeWidth="0.5"
                  opacity="0.12"
                />
              </pattern>
            </defs>
            <rect width="400" height="420" fill="url(#g)" />
          </svg>

          {/* Vignette */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: mapToneOverlay,
            }}
          />

          {/* Weather pill + profile avatar */}
          <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-3">
            {(() => {
              const w = weather
                ? describeWeather(weather.code, weather.isDay)
                : { Icon: Cloud, label: 'Carregando climaâ€¦' };
              const WIcon = w.Icon;
              return (
                <span
                  className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full max-w-[78%]"
                  style={{ background: PAPER, color: INK }}
                  title={
                    neighborhood ||
                    loc?.name ||
                    loc?.city ||
                    'Sua localizaÃ§Ã£o'
                  }
                >
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: BRAND }}
                  >
                    <WIcon
                      className="w-3.5 h-3.5"
                      strokeWidth={2.4}
                      style={{ color: '#0B1410' }}
                    />
                  </span>
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <span
                      style={{
                        fontFamily: 'Space Grotesk, sans-serif',
                        fontWeight: 700,
                        fontSize: 15,
                        lineHeight: 1,
                      }}
                    >
                      {weather ? `${weather.temp}Â°` : 'â€”'}
                    </span>
                    <span
                      className="text-[10px] font-bold uppercase tracking-[0.18em] truncate"
                      style={{ opacity: 0.75 }}
                    >
                      {w.label}
                    </span>
                  </span>
                </span>
              );
            })()}
          </div>

          {/* Map Center Indicator */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-12 h-12 flex items-center justify-center">
              <span
                className="absolute inset-0 rounded-full animate-ping"
                style={{ background: BRAND, opacity: 0.3, animationDuration: '3s' }}
              />
              <div
                className="relative w-4 h-4 rounded-full"
                style={{
                  background: BRAND,
                  border: `3px solid ${PAPER}`,
                  boxShadow: `0 0 20px ${BRAND}80`,
                }}
              />
            </div>
          </div>

          {/* Enable-location CTA, shown only when there's no location */}
          {!loc && (
            <div className="absolute inset-x-0 bottom-24 flex flex-col items-center justify-center px-6 text-center">
              <p
                className="mb-2 text-[10px] font-bold uppercase tracking-[0.28em]"
                style={{ color: PAPER, opacity: 0.85 }}
              >
                LocalizaÃ§Ã£o desativada
              </p>
              <button
                onClick={requestLocation}
                disabled={locRequesting}
                className="inline-flex items-center gap-2 px-5 h-11 rounded-full active:scale-95 transition-transform"
                style={{
                  background: BRAND,
                  color: '#0B1410',
                  fontFamily: 'Space Grotesk, sans-serif',
                  fontWeight: 700,
                  fontSize: 14,
                  letterSpacing: '-0.01em',
                  boxShadow: '0 10px 28px rgba(0,0,0,0.35)',
                }}
              >
                <MapPin className="w-4 h-4" strokeWidth={2.6} />
                {locRequesting
                  ? 'Buscandoâ€¦'
                  : locDenied
                  ? 'Permitir nas configuraÃ§Ãµes'
                  : 'Ativar localizaÃ§Ã£o'}
              </button>
            </div>
          )}

          {/* CTA */}
          <div className="absolute left-4 right-4 bottom-4">
            <button
              onClick={(e) => {
                e.stopPropagation();
                startWalk();
              }}
              className="w-full h-[72px] flex items-center justify-center group active:scale-[0.98] transition-all duration-300 relative overflow-hidden"
              style={{
                background: BRAND,
                color: '#0B1410',
                borderRadius: 24,
                boxShadow: `0 20px 40px -12px ${BRAND}66`
              }}
            >
              <div className="relative h-7 w-full flex flex-col items-center justify-center">
                <p
                  className="absolute transition-all duration-500 transform group-hover:-translate-y-12 group-hover:opacity-0"
                  style={{
                    fontFamily: 'Space Grotesk, sans-serif',
                    fontWeight: 700,
                    fontSize: 22,
                    letterSpacing: '-0.03em',
                  }}
                >
                  Buscar passeio
                </p>
                <p
                  className="absolute transition-all duration-500 transform translate-y-12 opacity-0 group-hover:translate-y-0 group-hover:opacity-100"
                  style={{
                    fontFamily: 'Space Grotesk, sans-serif',
                    fontWeight: 700,
                    fontSize: 22,
                    letterSpacing: '-0.03em',
                  }}
                >
                  Bora passear!
                </p>
              </div>
            </button>
          </div>
        </motion.section>

        {/* ============ WEEKLY GOAL + STATS (redesigned) ============ */}
        {(() => {
          const done = Math.min(weekDone, WEEK_GOAL);
          const pct = Math.min(100, Math.round((done / WEEK_GOAL) * 100));
          const remaining = Math.max(0, WEEK_GOAL - done);
          const complete = done >= WEEK_GOAL;
          const avgMin = stats.count ? Math.round(stats.minutes / stats.count) : 0;
          // Ring geometry
          const R = 30;
          const C = 2 * Math.PI * R;
          const dash = (pct / 100) * C;
          const todayIdx = (new Date().getDay() + 6) % 7; // Mon=0..Sun=6
          const dayLabels = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

          return (
            <section className="space-y-2.5">
              {/* Weekly goal â€” full-width editorial card */}
              <div
                className="relative overflow-hidden pt-2 pb-5"
                style={{
                  color: INK,
                }}
              >

                <div className="relative flex items-start justify-between gap-4">
                  {/* Left: label + count + helper */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {complete && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-[0.18em]"
                          style={{ background: BRAND, color: '#0B1410' }}
                        >
                          <Flame className="w-2.5 h-2.5" strokeWidth={2.6} />
                          Feito
                        </span>
                      )}
                    </div>

                    <p
                      className="mt-2 leading-none flex items-baseline gap-1.5"
                      style={{
                        fontFamily: 'Space Grotesk, sans-serif',
                        fontWeight: 700,
                        letterSpacing: '-0.03em',
                      }}
                    >
                      <span style={{ fontSize: 44 }}>{done}</span>
                      <span style={{ fontSize: 18, opacity: 0.45 }}>/ {WEEK_GOAL}</span>
                    </p>
                    <p
                      className="mt-2 text-[11px] font-semibold leading-snug"
                      style={{ opacity: 0.72, maxWidth: 180 }}
                    >
                      {complete
                        ? 'Meta concluÃ­da â€” boa, vocÃªs dois.'
                        : remaining === 1
                        ? 'SÃ³ mais 1 para fechar a semana.'
                        : `Faltam ${remaining} passeios essa semana.`}
                    </p>
                  </div>

                  {/* Right: ring */}
                  <div className="relative w-[78px] h-[78px] flex-shrink-0">
                    <svg viewBox="0 0 78 78" className="w-full h-full -rotate-90">
                      <circle
                        cx="39"
                        cy="39"
                        r={R}
                        fill="none"
                        stroke={`${INK}14`}
                        strokeWidth="7"
                      />
                      <circle
                        cx="39"
                        cy="39"
                        r={R}
                        fill="none"
                        stroke={BRAND}
                        strokeWidth="7"
                        strokeLinecap="round"
                        strokeDasharray={`${dash} ${C}`}
                        style={{ transition: 'stroke-dasharray 700ms cubic-bezier(.22,1,.36,1)' }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span
                        style={{
                          fontFamily: 'Space Grotesk, sans-serif',
                          fontWeight: 700,
                          fontSize: 16,
                          letterSpacing: '-0.02em',
                          color: INK,
                        }}
                      >
                        {pct}
                        <span style={{ fontSize: 10, opacity: 0.6 }}>%</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Weekday dots with labels */}
                <div className="relative mt-6 flex items-end justify-between gap-1.5 px-0.5">
                  {dayLabels.map((d, i) => {
                    const filled = weekDaysDone[i];
                    const isToday = i === todayIdx;
                    return (
                      <div key={i} className="flex flex-col items-center gap-2 flex-1 group">
                        <div
                          className="w-full rounded-full transition-all duration-500 relative"
                          style={{
                            height: filled ? 12 : 6,
                            background: filled 
                              ? BRAND 
                              : isToday 
                                ? `${BRAND}33` 
                                : `${INK}0D`,
                            boxShadow: isToday && !filled 
                              ? `0 0 10px ${BRAND}22` 
                              : 'none',
                          }}
                        >
                          {isToday && !filled && (
                            <span 
                              className="absolute inset-0 rounded-full animate-pulse"
                              style={{ border: `1px solid ${BRAND}44` }}
                            />
                          )}
                        </div>
                        <span
                          className="text-[10px] font-bold tracking-[0.05em] transition-colors"
                          style={{
                            fontFamily: 'Space Grotesk, sans-serif',
                            color: isToday ? BRAND : INK,
                            opacity: isToday || filled ? 1 : 0.35,
                          }}
                        >
                          {d}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2-up stat row - REMOVED DISTANCE/TIME KPIs AS REQUESTED */}

              {/* Minimal Services Access - Swiss Style */}
              <section className="pt-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] mb-4 opacity-40">Explorar</p>
                <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-1 px-1">
                  <button 
                    onClick={() => navigate('/petshop')}
                    className="flex-shrink-0 flex flex-col items-center gap-2 group active:scale-95 transition-all"
                  >
                    <div 
                      className="w-[72px] h-[72px] rounded-3xl flex items-center justify-center transition-all group-hover:bg-brand"
                      style={{ background: `${INK}08`, border: `1px solid ${INK}0D` }}
                    >
                      <ShoppingBag className="w-6 h-6" strokeWidth={1.5} />
                    </div>
                    <span className="text-[11px] font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>PetShop</span>
                  </button>

                  <button 
                    onClick={() => navigate('/veterinario')}
                    className="flex-shrink-0 flex flex-col items-center gap-2 group active:scale-95 transition-all"
                  >
                    <div 
                      className="w-[72px] h-[72px] rounded-3xl flex items-center justify-center transition-all"
                      style={{ background: `${INK}08`, border: `1px solid ${INK}0D` }}
                    >
                      <Stethoscope className="w-6 h-6" strokeWidth={1.5} />
                    </div>
                    <span className="text-[11px] font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Vet</span>
                  </button>

                  <button 
                    onClick={() => navigate('/historico')}
                    className="flex-shrink-0 flex flex-col items-center gap-2 group active:scale-95 transition-all"
                  >
                    <div 
                      className="w-[72px] h-[72px] rounded-3xl flex items-center justify-center transition-all"
                      style={{ background: `${INK}08`, border: `1px solid ${INK}0D` }}
                    >
                      <Activity className="w-6 h-6" strokeWidth={1.5} />
                    </div>
                    <span className="text-[11px] font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>HistÃ³rico</span>
                  </button>
                  
                  <button 
                    onClick={() => navigate('/ajuda')}
                    className="flex-shrink-0 flex flex-col items-center gap-2 group active:scale-95 transition-all"
                  >
                    <div 
                      className="w-[72px] h-[72px] rounded-3xl flex items-center justify-center transition-all"
                      style={{ background: `${INK}08`, border: `1px solid ${INK}0D` }}
                    >
                      <Plus className="w-6 h-6 opacity-30" strokeWidth={1.5} />
                    </div>
                    <span className="text-[11px] font-bold opacity-30" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Mais</span>
                  </button>
                </div>
              </section>
            </section>
          );
        })()}

        
      </>
    )}
        <LocationBlockedModal 
          isOpen={showLocBlockedModal} 
          paper={PAPER} 
          ink={INK} 
        />
      </div>
    </motion.div>
  );
};

const MiniCard: React.FC<{
  value: string;
  label: string;
  accent?: boolean;
  paper: string;
  ink: string;
}> = ({ value, label, accent, paper, ink }) => (
  <div
    className="flex-1 p-3 flex flex-col justify-between"
    style={{
      background: accent ? BRAND : paper,
      color: accent ? '#0B1410' : ink,
      border: accent ? 'none' : `1px solid ${ink}1A`,
      borderRadius: 20,
      minHeight: 60,
    }}
  >
    <span
      className="text-[9px] font-bold uppercase tracking-[0.24em]"
      style={{ opacity: accent ? 0.7 : 0.55 }}
    >
      Total {label}
    </span>
    <span
      style={{
        fontFamily: 'Space Grotesk, sans-serif',
        fontWeight: 700,
        fontSize: 22,
        letterSpacing: '-0.02em',
        lineHeight: 1,
      }}
    >
      {value}
    </span>
  </div>
);

const StatTile: React.FC<{
  icon: React.ReactNode;
  value: string;
  unit: string;
  label: string;
  paper: string;
  ink: string;
  accent?: boolean;
}> = ({ icon, value, unit, label, paper, ink, accent }) => {
  const bg = accent ? '#31D880' : paper;
  const fg = accent ? '#0B1410' : ink;
  return (
    <div
      className="relative p-3 flex flex-col justify-between overflow-hidden"
      style={{
        background: bg,
        color: fg,
        border: accent ? 'none' : `1px solid ${ink}1A`,
        borderRadius: 20,
        minHeight: 92,
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="w-6 h-6 rounded-lg flex items-center justify-center"
          style={{
            background: accent ? '#0B1410' : `${ink}0F`,
            color: accent ? '#31D880' : ink,
          }}
        >
          {icon}
        </span>
        <span
          className="text-[8px] font-bold uppercase tracking-[0.22em]"
          style={{ opacity: accent ? 0.75 : 0.5 }}
        >
          {label}
        </span>
      </div>
      <p
        className="leading-none mt-2 flex items-baseline gap-1"
        style={{
          fontFamily: 'Space Grotesk, sans-serif',
          fontWeight: 700,
          letterSpacing: '-0.02em',
        }}
      >
        <span style={{ fontSize: 22 }}>{value}</span>
        <span style={{ fontSize: 11, opacity: accent ? 0.7 : 0.5 }}>{unit}</span>
      </p>
    </div>
  );
};

const QuickTile: React.FC<{
  label: string;
  sub: string;
  icon: React.ReactNode;
  onClick: () => void;
  paper: string;
  ink: string;
  variant: 'ink' | 'paper';
}> = ({ label, sub, icon, onClick, paper, ink, variant }) => {
  const isInk = variant === 'ink';
  const bg = isInk ? ink : paper;
  const fg = isInk ? paper : ink;
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden p-6 flex flex-col items-start gap-4 text-left active:scale-[0.97] transition-all duration-500"
      style={{
        background: bg,
        color: fg,
        border: isInk ? 'none' : `1px solid ${ink}14`,
        borderRadius: 32,
        minHeight: 160,
        boxShadow: isInk
          ? `0 24px 48px -12px ${BRAND}33`
          : `0 8px 32px -12px ${ink}26`,
      }}
    >
      <div
        aria-hidden
        className="absolute -right-8 -bottom-8 w-40 h-40 rounded-full pointer-events-none transition-transform duration-700 group-hover:scale-110"
        style={{
          background: isInk
            ? `radial-gradient(circle, #31D88026 0%, transparent 70%)`
            : `radial-gradient(circle, ${ink}08 0%, transparent 70%)`,
        }}
      />
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-500 group-hover:rotate-6 group-hover:scale-110"
        style={{
          background: isInk ? BRAND : ink,
          color: isInk ? '#0B1410' : paper,
          boxShadow: isInk ? `0 12px 24px ${BRAND}40` : 'none'
        }}
      >
        {React.cloneElement(icon as React.ReactElement, { className: 'w-6 h-6' })}
      </div>
      <div className="relative mt-auto w-full">
        <p
          className="text-[10px] font-bold uppercase tracking-[0.3em] mb-1.5"
          style={{ opacity: isInk ? 0.7 : 0.4, color: isInk ? BRAND : 'inherit' }}
        >
          {sub}
        </p>
        <div className="flex items-center justify-between w-full">
          <p
            className="leading-none flex items-center gap-1.5"
            style={{
              fontFamily: 'Space Grotesk, sans-serif',
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: '-0.03em',
            }}
          >
            {label}
          </p>
          <div 
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500 group-hover:translate-x-1 group-hover:-translate-y-1"
            style={{ background: isInk ? `${paper}1A` : `${ink}0D` }}
          >
            <ArrowUpRight
              className="w-4 h-4"
              style={{ opacity: 0.8, color: isInk ? BRAND : 'inherit' }}
              strokeWidth={2.8}
            />
          </div>
        </div>
      </div>
    </button>
  );
};

const QuickPill: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  paper: string;
  ink: string;
}> = ({ label, icon, onClick, paper, ink }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2.5 px-4 py-3 active:scale-[0.98] transition-transform"
    style={{
      background: paper,
      border: `1px solid ${ink}1A`,
      borderRadius: 18,
      color: ink,
    }}
  >
    <div
      className="w-8 h-8 rounded-xl flex items-center justify-center"
      style={{ background: ink, color: paper }}
    >
      {icon}
    </div>
    <span
      className="font-semibold text-[13px]"
      style={{ fontFamily: 'Space Grotesk, sans-serif' }}
    >
      {label}
    </span>
    <ArrowUpRight
      className="w-3.5 h-3.5 ml-auto"
      style={{ opacity: 0.4 }}
      strokeWidth={2.5}
    />
  </button>
);

const MapFallback: React.FC<{ background: string; line: string }> = ({ background, line }) => (
  <svg
    className="absolute inset-0 w-full h-full"
    viewBox="0 0 400 420"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden
  >
    <rect width="400" height="420" fill={background} />
    {Array.from({ length: 12 }).map((_, i) => (
      <line
        key={i}
        x1="0"
        y1={i * 40}
        x2="400"
        y2={i * 40 - 80}
        stroke={line}
        strokeOpacity="0.08"
        strokeWidth="1"
      />
    ))}
    <circle cx="200" cy="210" r="110" fill="none" stroke={BRAND} strokeOpacity="0.3" />
    <circle cx="200" cy="210" r="70" fill="none" stroke={BRAND} strokeOpacity="0.5" />
  </svg>
);

const LocationBlockedModal: React.FC<{
  isOpen: boolean;
  paper: string;
  ink: string;
}> = ({ isOpen, paper, ink }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center px-5 pb-8 sm:items-center sm:pb-0">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-md" 
      />
      <div 
        className="relative w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-300"
        style={{ 
          background: paper, 
          color: ink, 
          borderRadius: 32,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }}
      >
        <div className="p-8 text-center">
          <div 
            className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-6"
            style={{ background: '#31D880', color: '#0B1410' }}
          >
            <MapPin className="w-8 h-8" strokeWidth={2.5} />
          </div>
          
          <h3 
            className="text-2xl font-bold mb-3"
            style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}
          >
            LocalizaÃ§Ã£o bloqueada
          </h3>
          
          <p className="text-[14px] leading-relaxed mb-8" style={{ opacity: 0.7 }}>
            Para usar o VaiPet, vocÃª precisa autorizar o acesso Ã  sua localizaÃ§Ã£o. Isso nos permite encontrar os melhores walkers e garantir a seguranÃ§a do seu pet.
          </p>
          
          <div className="space-y-3">
            <button
              onClick={() => window.location.reload()}
              className="w-full h-14 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
              style={{ background: '#0B1410', color: '#F7F5EF' }}
            >
              <Activity className="w-5 h-5" />
              Tentar novamente
            </button>
            <p className="text-[11px] font-medium" style={{ opacity: 0.5 }}>
              Verifique as permissÃµes de site do seu navegador.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const SkeletonItem: React.FC<{ className?: string, style?: React.CSSProperties }> = ({ className, style }) => (
  <div 
    className={`animate-pulse bg-current opacity-10 rounded-xl ${className}`}
    style={style}
  />
);

const HomeSkeleton: React.FC<{ paper: string, ink: string }> = ({ paper, ink }) => (
  <div className="space-y-6" style={{ color: ink }}>
    {/* Header */}
    <div className="flex items-end justify-between">
      <div className="space-y-2">
        <SkeletonItem className="h-10 w-32" />
        <SkeletonItem className="h-10 w-44" />
      </div>
      <div className="flex gap-2">
        <SkeletonItem className="w-10 h-10 rounded-full" />
        <div className="flex flex-col items-end gap-1">
          <SkeletonItem className="h-2 w-12" />
          <SkeletonItem className="h-6 w-8" />
        </div>
      </div>
    </div>

    {/* Pet Chips */}
    <div className="flex gap-2 overflow-hidden">
      {[1, 2, 3].map(i => (
        <SkeletonItem key={i} className="h-10 w-28 rounded-full flex-shrink-0" />
      ))}
      <SkeletonItem className="w-10 h-10 rounded-full flex-shrink-0" />
    </div>

    {/* Hero Map */}
    <SkeletonItem 
      className="w-full rounded-[28px]" 
      style={{ aspectRatio: '4/4.2' }} 
    />

    {/* Stats / Last Walk */}
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <SkeletonItem className="h-4 w-32" />
        <SkeletonItem className="h-4 w-16" />
      </div>
      <SkeletonItem className="h-28 w-full rounded-3xl" />
    </div>

    {/* Quick Buttons */}
    <div className="grid grid-cols-2 gap-3">
      <SkeletonItem className="h-24 w-full rounded-[28px]" />
      <SkeletonItem className="h-24 w-full rounded-[28px]" />
    </div>
  </div>
);