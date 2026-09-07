import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Star, ArrowLeft } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import dogGlbAsset from '@/assets/dog-walk.glb.asset.json';

interface ReviewWalkProps {
  onBack: () => void;
  onComplete: () => void;
  petName: string;
  walkerName: string;
  walkDuration: number;
  isDarkMode?: boolean;
  sessionId?: string;
}

interface SessionData {
  planned: number | null;
  actual: number | null;
  endTime: string | null;
  startTime: string | null;
  distanceKm: number | null;
  routeCoords: [number, number][];
  homeLocation: [number, number] | null;
  pet: { name: string; breed: string; avatar_url: string | null; age: number | null; weight: number | null } | null;
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// Compact 3D dog avatar — pure decorative, slowly rotating.
const DogAvatar: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const sz = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(w, h, false);
    };
    sz();
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 1.4, 5.2);
    camera.lookAt(0, 0.5, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const key = new THREE.DirectionalLight(0xffffff, 1);
    key.position.set(2, 4, 3);
    scene.add(key);
    const pivot = new THREE.Group();
    scene.add(pivot);
    let mixer: THREE.AnimationMixer | null = null;
    let disposed = false;
    const loader = new GLTFLoader();
    loader.load(dogGlbAsset.url, (gltf) => {
      if (disposed) return;
      const m = gltf.scene;
      m.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(m);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const longest = Math.max(size.x, size.y, size.z) || 1;
      m.scale.setScalar(2 / longest);
      const bbox2 = new THREE.Box3().setFromObject(m);
      const ctr = new THREE.Vector3();
      bbox2.getCenter(ctr);
      m.position.x -= ctr.x;
      m.position.z -= ctr.z;
      m.position.y -= bbox2.min.y;
      pivot.add(m);
      if (gltf.animations?.length) {
        mixer = new THREE.AnimationMixer(m);
        const act = mixer.clipAction(gltf.animations[0]);
        act.timeScale = 0.85;
        act.play();
      }
    });
    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      const dt = clock.getDelta();
      pivot.rotation.y += dt * 0.6;
      if (mixer) mixer.update(dt);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { disposed = true; cancelAnimationFrame(raf); renderer.dispose(); };
  }, []);
  return <canvas ref={canvasRef} className="w-full h-full block" />;
};

export const ReviewWalk: React.FC<ReviewWalkProps> = ({ onBack, onComplete, petName, walkerName, walkDuration, isDarkMode = false, sessionId }) => {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [data, setData] = useState<SessionData | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const { toast } = useToast();

  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      const { data: row, error: fetchError } = await supabase
        .from('walk_sessions')
        .select('planned_duration_minutes, actual_duration_minutes, end_time, start_time, distance_km, route_coordinates, home_location, pets:pet_id(name, breed, avatar_url, age, weight)')
        .eq('id', sessionId)
        .maybeSingle();
      if (fetchError) {
        // FAIL CLOSED: erro factual — nunca fingir que os dados persistidos
        // foram carregados. Mantém o fallback visual (data === null) sem
        // alegar valores reais.
        console.error('[ReviewWalk] Falha ao carregar dados persistidos da sessão:', fetchError);
        if (!cancelled) setFetchFailed(true);
        return;
      }
      if (cancelled || !row) return;
      const raw = (row.route_coordinates as any) || [];
      const coords: [number, number][] = Array.isArray(raw)
        ? raw.filter((c: any) => Array.isArray(c) && c.length >= 2).map((c: any) => [Number(c[0]), Number(c[1])])
        : [];
      const home = row.home_location as any;
      setData({
        planned: row.planned_duration_minutes ?? null,
        actual: row.actual_duration_minutes ?? null,
        endTime: row.end_time ?? null,
        startTime: row.start_time ?? null,
        distanceKm: row.distance_km != null ? Number(row.distance_km) : null,
        routeCoords: coords,
        homeLocation: home && typeof home.lng === 'number' ? [home.lng, home.lat] : null,
        pet: (row as any).pets ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Build map once we have a container + coords.
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const coords = data?.routeCoords || [];
    const center: [number, number] = coords[0] || data?.homeLocation || [-46.633, -23.55];
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: isDarkMode ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
      center,
      zoom: 14,
      interactive: false,
      attributionControl: false,
    });
    mapRef.current = map;
    map.on('load', () => {
      // Hide labels for cleanliness
      for (const l of map.getStyle().layers || []) {
        if (l.type === 'symbol') try { map.setLayoutProperty(l.id, 'visibility', 'none'); } catch {}
      }
      if (coords.length >= 2) {
        map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
        map.addLayer({
          id: 'route-glow', type: 'line', source: 'route',
          paint: { 'line-color': '#31d880', 'line-width': 12, 'line-opacity': 0.18, 'line-blur': 6 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        map.addLayer({
          id: 'route-line', type: 'line', source: 'route',
          paint: { 'line-color': '#31d880', 'line-width': 4 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        const mkDot = (color: string, ring: string) => {
          const el = document.createElement('div');
          el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:3px solid ${ring};box-shadow:0 2px 8px rgba(0,0,0,0.2)`;
          return el;
        };
        new mapboxgl.Marker({ element: mkDot('#31d880', '#ffffff'), anchor: 'center' }).setLngLat(coords[0]).addTo(map);
        new mapboxgl.Marker({ element: mkDot('#0a1a14', '#31d880'), anchor: 'center' }).setLngLat(coords[coords.length - 1]).addTo(map);
        const bounds = coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
        map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 16 });
      }
    });
    return () => { map.remove(); mapRef.current = null; };
  }, [data, isDarkMode]);

  // FAIL CLOSED: a tela só avança (onComplete) após o update ser confirmado
  // pelo backend (error === null). Em erro: permanece na tela, sem toast de
  // sucesso, e o usuário pode tentar novamente.
  const handleSubmit = async () => {
    if (rating === 0) { toast({ title: 'Avaliação necessária', description: 'Selecione de 1 a 5 estrelas.', variant: 'destructive' }); return; }
    setIsSubmitting(true);
    try {
      // FAIL CLOSED real: sucesso SOMENTE com evidência factual da linha
      // atualizada (id === sessionId). Sem sessionId, com error, ou sem
      // retorno da linha — permanece na tela com toast de erro.
      if (!sessionId) {
        console.error('[ReviewWalk] Falha ao enviar avaliação: sessionId ausente.');
        toast({ title: 'Erro ao enviar avaliação', description: 'Tente novamente.', variant: 'destructive' });
        return;
      }
      const { data, error } = await supabase
        .from('walk_sessions')
        .update({ rating, feedback: comment || null })
        .eq('id', sessionId)
        .select('id, rating, feedback')
        .maybeSingle();
      if (error || !data || data.id !== sessionId || Number(data.rating) !== rating) {
        console.error('[ReviewWalk] Falha ao confirmar avaliação no backend:', { error, data });
        toast({ title: 'Erro ao enviar avaliação', description: 'Tente novamente.', variant: 'destructive' });
        return;
      }
      toast({ title: 'Avaliação enviada' });
      onComplete();
    } catch (e) {
      console.error('Review save exception:', e);
      toast({ title: 'Erro ao enviar avaliação', description: 'Tente novamente.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const surface = isDarkMode ? '#0B1410' : '#fbfbfa';
  const ink = isDarkMode ? '#f5f7f6' : '#0a1a14';
  const inkSoft = isDarkMode ? 'rgba(245,247,246,0.5)' : 'rgba(10,26,20,0.5)';
  const hairline = isDarkMode ? 'rgba(255,255,255,0.07)' : 'rgba(10,26,20,0.06)';
  const cardBg = isDarkMode ? 'rgba(255,255,255,0.03)' : '#ffffff';

  const pet = data?.pet;
  const actualMin = data?.actual ?? Math.max(1, Math.round(walkDuration / 60));
  const distance = data?.distanceKm != null ? data.distanceKm.toFixed(2) : '—';
  const pace = data?.distanceKm && actualMin ? (actualMin / data.distanceKm).toFixed(1) : '—';
  const timeRange = data?.startTime && data?.endTime
    ? `${new Date(data.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} – ${new Date(data.endTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : null;

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto" style={{ background: surface }} data-testid="review-walk-screen">
      <div className="min-h-full flex flex-col max-w-md mx-auto">
        {/* Minimal header */}
        <div className="px-6 pt-12 pb-6 flex items-center justify-between">
          <div className="w-9" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: inkSoft }}>Passeio concluído</p>
          <div className="w-9" />
        </div>

        {fetchFailed && (
          <div className="px-6 pb-2">
            <p
              className="text-[10px] font-semibold text-center rounded-full px-3 py-2"
              style={{ color: '#b45309', background: 'rgba(180,83,9,0.08)', border: '1px solid rgba(180,83,9,0.2)' }}
            >
              Não foi possível carregar os dados persistidos do passeio — exibindo resumo local.
            </p>
          </div>
        )}

        {/* Map hero — real trajectory */}
        <div className="px-6">
          <div
            className="relative w-full rounded-[28px] overflow-hidden"
            style={{ height: 320, border: `1px solid ${hairline}` }}
          >
            <div ref={mapContainer} className="absolute inset-0" />
            {/* gradient veil for legibility */}
            <div className="absolute inset-x-0 bottom-0 h-32 pointer-events-none"
              style={{ background: `linear-gradient(180deg, transparent 0%, ${surface} 100%)` }}
            />
            {/* dog avatar floats in corner */}
            <div className="absolute top-3 right-3 w-16 h-16 rounded-full overflow-hidden"
              style={{ background: isDarkMode ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.8)', border: `1px solid ${hairline}`, backdropFilter: 'blur(8px)' }}>
              <DogAvatar />
            </div>
            {/* distance pill */}
            <div className="absolute bottom-4 left-4 px-3 py-1.5 rounded-full text-xs font-bold flex items-baseline gap-1"
              style={{ background: isDarkMode ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.92)', color: ink, backdropFilter: 'blur(10px)', border: `1px solid ${hairline}` }}>
              <span>{distance}</span><span className="text-[10px] font-medium" style={{ color: inkSoft }}>km percorridos</span>
            </div>
          </div>
        </div>

        {/* Pet identity */}
        <div className="px-6 pt-6 pb-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] mb-1" style={{ color: inkSoft }}>Passeio de</p>
          <h2 className="text-[28px] font-extrabold tracking-tight leading-none" style={{ color: ink }}>{pet?.name || petName}</h2>
          <p className="text-sm mt-1.5" style={{ color: inkSoft }}>
            {[pet?.breed, pet?.age ? `${pet.age} anos` : null, pet?.weight ? `${pet.weight} kg` : null].filter(Boolean).join(' · ') || 'Cachorro'}
            <span className="mx-1.5">·</span>com <span style={{ color: ink }}>{walkerName}</span>
          </p>
        </div>

        {/* Stats — flat row, no cards */}
        <div className="px-6 pt-6">
          <div className="grid grid-cols-3" style={{ borderTop: `1px solid ${hairline}`, borderBottom: `1px solid ${hairline}` }}>
            {[
              { label: 'Duração', value: `${actualMin}`, unit: 'min' },
              { label: 'Distância', value: distance, unit: 'km' },
              { label: 'Ritmo', value: pace, unit: 'min/km' },
            ].map((it, i) => (
              <div key={i} className="py-4 text-center" style={i < 2 ? { borderRight: `1px solid ${hairline}` } : undefined}>
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] mb-1" style={{ color: inkSoft }}>{it.label}</p>
                <p className="text-xl font-extrabold tracking-tight leading-none" style={{ color: ink }} data-testid={['review-duration', 'review-distance'][i]}>{it.value}</p>
                <p className="text-[10px] mt-0.5" style={{ color: inkSoft }}>{it.unit}</p>
              </div>
            ))}
          </div>
          {timeRange && (
            <p className="text-[10px] mt-2 text-center" style={{ color: inkSoft }}>{timeRange}</p>
          )}
        </div>

        {/* Rating — minimal */}
        <div className="px-6 pt-8">
          <p className="text-xs font-semibold text-center mb-3" style={{ color: ink }}>Como foi o passeio?</p>
          <div className="flex justify-center gap-1">
            {[1,2,3,4,5].map(star => {
              const active = star <= (hoveredRating || rating);
              return (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  className="p-1 transition-transform active:scale-90"
                >
                  <Star
                    className={`w-8 h-8 transition-all ${active ? 'fill-yellow-400 text-yellow-400' : ''}`}
                    style={!active ? { color: isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(10,26,20,0.15)' } : undefined}
                    strokeWidth={1.5}
                  />
                </button>
              );
            })}
          </div>
          {rating > 0 && (
            <p className="text-center text-[11px] mt-2 font-medium" style={{ color: '#31d880' }}>
              {['Péssimo','Ruim','Ok','Bom','Excelente'][rating - 1]}
            </p>
          )}
        </div>

        {/* Comment — barely-there input */}
        <div className="px-6 pt-6">
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Deixe um comentário (opcional)"
            rows={2}
            className="rounded-2xl resize-none text-sm"
            style={{ background: cardBg, border: `1px solid ${hairline}`, color: ink }}
          />
        </div>

        {/* Submit */}
        <div className="px-6 pt-5 pb-8 mt-auto">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || rating === 0}
            className="w-full py-4 rounded-full font-semibold text-sm tracking-wide text-white transition-all active:scale-[0.98] disabled:opacity-30"
            style={{ background: '#31d880', boxShadow: '0 6px 18px -6px rgba(49,216,128,0.55)' }}
          >
            {isSubmitting ? 'Enviando…' : 'Enviar avaliação'}
          </button>
          <button
            onClick={onComplete}
            className="w-full mt-3 py-3 rounded-full font-semibold text-xs tracking-wide transition-all active:scale-[0.98]"
            style={{ color: inkSoft, background: 'transparent' }}
          >
            Voltar para o início
          </button>
        </div>
      </div>
    </div>
  );
};
