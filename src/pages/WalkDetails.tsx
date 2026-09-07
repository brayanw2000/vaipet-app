import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { hideMapLabels, enrichMap, tintMapInk } from '@/lib/mapStyle';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import 'mapbox-gl/dist/mapbox-gl.css';

import { ArrowLeft, Clock, Calendar, Route, DollarSign, MapPin, Flag, Home, Star, Timer, ShieldCheck, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePetwalkerGps } from '@/hooks/usePetwalkerGps';
import { toast } from 'sonner';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const fmtDuration = (m?: number | null) => {
  if (!m) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}min` : `${h}h`;
};

export const WalkDetails: React.FC<{ isOperational?: boolean }> = ({ isOperational = false }) => {
  const { id } = useParams<{ name: string; id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const { theme } = useHomeTheme();
  const isDarkMode = theme === 'dark';
  const [walk, setWalk] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [concluding, setConcluding] = useState(false);
  const [concludeError, setConcludeError] = useState<string | null>(null);
  const [arriving, setArriving] = useState(false);

  const { coords, accuracy, status: gpsStatus } = usePetwalkerGps();

  // PIN states
  const [pinValue, setPinValue] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const handleConfirmPickup = async () => {
    if (!pinValue || pinValue.length !== 6 || pinLoading || !walk?.id) return;
    setPinLoading(true);
    setPinError(null);
    try {
      const { data, error } = await supabase.rpc('petwalker_confirm_pickup', {
        walk_id: walk.id,
        input_pin: pinValue
      });
      if (error) {
        setPinError(error.message);
        setPinLoading(false);
        return;
      }
      if (data === true) {
        window.location.reload();
        return;
      }
      setPinError('PIN incorreto ou inválido.');
      setPinLoading(false);
    } catch (e) {
      setPinError('Erro ao validar PIN. Tente novamente.');
      setPinLoading(false);
    }
  };

  const handleCompleteWalk = async () => {
    if (concluding || !walk?.id) return;
    setConcluding(true);
    setConcludeError(null);
    try {
      const { data, error } = await supabase.rpc('petwalker_complete_walk', {
        _session_id: walk.id
      });
      if (error) {
        setConcludeError(error.message);
        setConcluding(false);
        return;
      }
      if (data === true) {
        navigate('/petwalker');
        return;
      }
      setConcludeError('Não foi possível concluir o passeio. Tente novamente.');
      setConcluding(false);
    } catch (e) {
      setConcludeError('Erro inesperado ao concluir o passeio. Tente novamente.');
      setConcluding(false);
    }
  };

  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      const { data, error } = await supabase
        .from('walk_sessions')
        .select('*, pets:pet_id(name, avatar_url)')
        .eq('id', id)
        .maybeSingle();
      if (error) console.error('WalkDetails fetch error', error);
      setWalk(data);
      setLoading(false);
    })();
  }, [id, user]);

  // Initialize map with the persisted trail
  useEffect(() => {
    if (!walk || !mapContainer.current || map.current) return;
    const coords = (walk.route_coordinates as [number, number][] | null) || [];
    const start = coords[0] || (walk.home_location ? [walk.home_location.lng, walk.home_location.lat] : null);
    if (!start) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/standard",
      center: start,
      zoom: 16,
      pitch: 40,
      interactive: true,
      attributionControl: false,
      config: {
        basemap: {
          lightPreset: isDarkMode ? "night" : "day",
          theme: isDarkMode ? "default" : "faded",
        }
      }
    });
    map.current.on('load', () => {
      const m = map.current!;
      hideMapLabels(m);
      enrichMap(m, !isDarkMode);
      tintMapInk(m, isDarkMode);

      if (coords.length >= 2) {
        m.addSource('trail', {
          type: 'geojson',
          lineMetrics: true,
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        });
        m.addLayer({
          id: 'trail-glow', type: 'line', source: 'trail',
          paint: { 'line-color': '#31D880', 'line-width': 14, 'line-opacity': 0.18, 'line-blur': 6 },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        });
        m.addLayer({
          id: 'trail-line', type: 'line', source: 'trail',
          paint: {
            'line-width': 7,
            'line-gradient': [
              'interpolate', ['linear'], ['line-progress'],
              0,   'rgba(0, 169, 120, 0.10)',
              0.5, 'rgba(0, 169, 120, 0.50)',
              1,   'rgba(0, 169, 120, 1.00)',
            ] as any,
          },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        });
        // Start + end pins
        const startEl = document.createElement('div');
        startEl.innerHTML = '<div style="width:28px;height:28px;border-radius:50%;background:#31D880;border:4px solid white;box-shadow:0 4px 12px rgba(0,0,0,0.25);"></div>';
        new mapboxgl.Marker(startEl).setLngLat(coords[0]).addTo(m);
        const endEl = document.createElement('div');
        endEl.innerHTML = '<div style="width:34px;height:34px;border-radius:50%;background:white;border:4px solid #31D880;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.25);font-weight:800;color:#31D880;font-size:14px;">🏁</div>';
        new mapboxgl.Marker(endEl).setLngLat(coords[coords.length - 1]).addTo(m);
        const bounds = coords.reduce((b, c) => b.extend(c as any), new mapboxgl.LngLatBounds(coords[0] as any, coords[0] as any));
        m.fitBounds(bounds, { padding: 60, duration: 1200 });
      }
    });
    return () => { map.current?.remove(); map.current = null; };
  }, [walk, isDarkMode]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!walk) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">Passeio não encontrado</p>
        <button onClick={() => navigate(-1)} className="text-sm font-bold text-accent">Voltar</button>
      </div>
    );
  }

  const trailPoints = (walk.route_coordinates as [number, number][] | null) || [];
  const duration = walk.actual_duration_minutes || walk.planned_duration_minutes;
  const distance = Number(walk.distance_km || 0);
  const price = walk.total_price_cents ? walk.total_price_cents / 100 : 0;

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto pb-32">
      {/* Header */}
      <div className="px-4 pt-8 pb-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-card border border-border/40 flex items-center justify-center active:scale-95 transition-transform"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-extrabold text-foreground truncate">Detalhes do passeio</h1>
          <p className="text-xs text-muted-foreground font-medium truncate">
            {walk.pets?.name || 'Pet'} • {fmtDate(walk.start_time || walk.created_at)}
          </p>
        </div>
      </div>

      {/* Trajeto */}
      <div className="px-4">
        <div className="rounded-3xl overflow-hidden border border-border/40 bg-card relative" style={{ height: 320 }}>
          {trailPoints.length >= 2 ? (
            <div ref={mapContainer} className="absolute inset-0" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
              <Route className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">Sem trajeto registrado</p>
              <p className="text-[11px] text-muted-foreground/60">Este passeio não armazenou pontos GPS.</p>
            </div>
          )}
          {trailPoints.length >= 2 && (
            <div className="absolute bottom-3 left-3 right-3 rounded-2xl bg-background/85 backdrop-blur px-3 py-2 flex items-center justify-between text-[11px] font-semibold">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-accent/30" /> Início</span>
              <span className="text-muted-foreground">{trailPoints.length} pontos</span>
              <span className="flex items-center gap-1.5">Fim <span className="w-2 h-2 rounded-full bg-accent" /></span>
            </div>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="px-4 mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-border/40 bg-card p-3">
          <Timer className="w-4 h-4 text-accent mb-1" />
          <p className="text-[10px] text-muted-foreground font-medium">Duração</p>
          <p className="text-sm font-extrabold text-foreground">{fmtDuration(duration)}</p>
        </div>
        <div className="rounded-2xl border border-border/40 bg-card p-3">
          <Route className="w-4 h-4 text-accent mb-1" />
          <p className="text-[10px] text-muted-foreground font-medium">Distância</p>
          <p className="text-sm font-extrabold text-foreground">{distance.toFixed(2)} km</p>
        </div>
        <div className="rounded-2xl border border-border/40 bg-card p-3">
          <DollarSign className="w-4 h-4 text-accent mb-1" />
          <p className="text-[10px] text-muted-foreground font-medium">Preço</p>
          <p className="text-sm font-extrabold text-foreground">R$ {price.toFixed(2)}</p>
        </div>
      </div>

      {/* Details List */}
      <div className="px-4 mt-6 space-y-4">
        <h2 className="text-sm font-black font-space uppercase tracking-widest text-muted-foreground px-1">Resumo da sessão</h2>
        <div className="rounded-3xl border border-border/40 bg-card p-6 space-y-6">
          <TimelineRow icon={<Calendar className="w-4 h-4 text-accent" />} label="Data" value={fmtDate(walk.start_time || walk.created_at)} />
          <TimelineRow icon={<Clock className="w-4 h-4 text-accent" />} label="Horário de início" value={fmtTime(walk.start_time || walk.created_at)} />
          <TimelineRow icon={<Flag className="w-4 h-4 text-accent" />} label="Horário de término" value={fmtTime(walk.completed_at)} />
          <TimelineRow icon={<Home className="w-4 h-4 text-accent" />} label="Ponto de encontro" value={walk.meeting_point_address || 'Endereço não disponível'} />
        </div>
      </div>

      {/* PIN Section for Owner */}
      {!isOperational && walk.current_status !== 'completed' && walk.current_status !== 'cancelled' && (
        <div className="px-4 mt-6">
          <div className="rounded-3xl bg-accent/10 border border-accent/20 p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center shrink-0 shadow-lg shadow-accent/20">
              <ShieldCheck className="w-6 h-6 text-ink" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-accent-foreground/60 mb-1">PIN de Retirada</p>
              <span className="text-2xl font-black font-space tracking-[0.2em] text-accent" data-testid="pickup-pin-display">
                <PickupCode session_id={walk.id} />
              </span>

            </div>
          </div>
        </div>
      )}

      {/* PetWalker Operational PIN Input or Status Buttons */}
      {isOperational && walk.current_status !== 'completed' && walk.current_status !== 'cancelled' && (
        <div className="fixed bottom-6 left-4 right-4 z-50 flex flex-col gap-3">
          {walk.current_status === 'arrived' && (
            <div className="bg-card border border-border/40 rounded-3xl p-5 shadow-2xl space-y-4 mb-2">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-accent" />
                <h3 className="text-sm font-black font-space uppercase">Confirmar Retirada</h3>
              </div>
              
              <div className="space-y-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="Digite o PIN de 6 dígitos"
                  maxLength={6}
                  value={pinValue}
                  onChange={(e) => setPinValue(e.target.value.replace(/[^0-9]/g, ''))}
                  className="h-14 rounded-2xl text-center text-2xl font-black font-space tracking-[0.5em] bg-background border-border/40 focus:ring-accent"
                  data-testid="pickup-pin-input"
                />
                
                {pinError && (
                  <div className="flex items-center gap-2 text-[11px] text-destructive font-bold px-1">
                    <AlertCircle size={12} />
                    <span>{pinError}</span>
                  </div>
                )}
              </div>

              <Button
                onClick={handleConfirmPickup}
                disabled={pinValue.length !== 6 || pinLoading}
                className="w-full h-12 rounded-2xl bg-ink text-white font-black hover:bg-ink/90 disabled:opacity-50"
                data-testid="pickup-pin-submit"
              >
                {pinLoading ? 'Validando...' : 'Confirmar Retirada'}
              </Button>
            </div>
          )}

          {walk.current_status === 'accepted' && (
            <button 
              onClick={async () => {
                const { error } = await supabase.rpc('petwalker_start_heading', { _session_id: walk.id });
                if (!error) window.location.reload();
              }}
              className="w-full bg-[#31D880] text-ink font-extrabold py-4 rounded-2xl shadow-xl active:scale-95 transition-transform"
            >
              Iniciar Deslocamento
            </button>
          )}

          {walk.current_status === 'heading_to_pickup' && (
            <button 
              onClick={async () => {
                if (!coords || accuracy === null) {
                  toast.error("Aguardando localização GPS. Tente novamente em alguns segundos.");
                  return;
                }
                setArriving(true);
                const [lng, lat] = coords;
                const { data, error } = await supabase.rpc('petwalker_arrive_pickup', { 
                  _session_id: walk.id,
                  _lat: lat,
                  _lng: lng,
                  _accuracy: accuracy
                });
                
                if (error) {
                  toast.error(`Erro: ${error.message}`);
                  setArriving(false);
                } else if (data === true) {
                  window.location.reload();
                } else {
                  setArriving(false);
                }
              }}
              disabled={arriving}
              className="w-full bg-blue-500 text-white font-extrabold py-4 rounded-2xl shadow-xl active:scale-95 transition-transform disabled:opacity-50"
            >
              {arriving ? 'Processando...' : (!coords || accuracy === null ? 'Aguardando GPS...' : 'Cheguei no Local')}
            </button>
          )}

          {walk.current_status === 'in_progress' && (
            <>
              {concludeError && (
                <div className="w-full rounded-2xl bg-destructive/10 text-destructive text-sm font-semibold px-4 py-3 mb-1">
                  {concludeError}
                </div>
              )}
              <div className="bg-ink/5 border border-ink/10 rounded-2xl p-4 mb-1 text-center">
                <p className="text-xs font-bold text-ink/60" data-testid="walk-in-progress-marker">Aviso de passeio em andamento</p>
                <p className="text-[10px] text-ink/40">Finalização indisponível na Phase 4.1</p>
              </div>
            </>
          )}


          <button 
            onClick={() => navigate('/petwalker')}
            className="w-full bg-card text-foreground border border-border/40 font-bold py-3 rounded-2xl active:scale-95 transition-transform text-sm"
          >
            Voltar ao Painel
          </button>
        </div>
      )}
    </div>
  );
};

const TimelineRow: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">{icon}</div>
    <div className="flex-1 min-w-0">
      <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
      <p className="text-sm font-bold text-foreground">{value}</p>
    </div>
  </div>
);

const PickupCode: React.FC<{ session_id: string }> = ({ session_id }) => {
  const [code, setCode] = useState<string>('------');
  
  useEffect(() => {
    const fetchCode = async () => {
      const { data, error } = await supabase.rpc('customer_get_pickup_code', { _session_id: session_id });
      if (!error && data) setCode(data);
      else if (error) console.error('PickupCode error:', error.message);

    };
    fetchCode();
  }, [session_id]);

  return <>{code}</>;
};

export default WalkDetails;
