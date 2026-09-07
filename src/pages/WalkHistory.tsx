import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ArrowLeft, Clock, PawPrint, ArrowUpRight, Star, History } from 'lucide-react';
import { useHomeTheme } from '@/hooks/useHomeTheme';

const BRAND = '#31D880';

interface WalkRow {
  id: string;
  walker_name: string | null;
  start_time: string | null;
  created_at: string;
  actual_duration_minutes: number | null;
  planned_duration_minutes: number | null;
  distance_km: number | null;
  rating: number | null;
  pet: { name: string; avatar_url: string | null } | null;
}

const slugify = (name: string) => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

const formatDate = (s: string) => {
  const d = new Date(s);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  if (diff < 7) return `Há ${diff} dias`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const WalkHistory: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;
  const [walks, setWalks] = useState<WalkRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('walk_sessions')
        .select('id, walker_name, start_time, created_at, actual_duration_minutes, planned_duration_minutes, distance_km, rating, pets:pet_id(name, avatar_url)')
        .eq('customer_id', user.id)
        .eq('current_status', 'completed')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setWalks(((data || []) as any[]).map(r => ({ ...r, pet: r.pets })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const totalMin = walks.reduce((s, w) => s + (w.actual_duration_minutes || w.planned_duration_minutes || 0), 0);
  const totalKm = walks.reduce((s, w) => s + (Number(w.distance_km) || 0), 0);

  return (
    <div
      className="min-h-screen max-w-md mx-auto pb-12"
      style={{ background: PAPER, color: INK, fontFamily: 'DM Sans, sans-serif' }}
    >
      {/* Top bar */}
      <div className="px-5 pt-6 pb-2 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          aria-label="Voltar"
          className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
          style={{ border: `1px solid ${INK}26`, color: INK }}
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={2.2} />
        </button>
        <span
          className="text-[10px] font-bold uppercase tracking-[0.28em]"
          style={{ opacity: 0.55 }}
        >
          Histórico
        </span>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: BRAND, color: '#0B1410' }}
        >
          <History className="w-4 h-4" strokeWidth={2.4} />
        </div>
      </div>

      {/* Headline */}
      <div className="px-5 pt-3 pb-5">
        <h1
          className="font-bold leading-[0.92]"
          style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 'clamp(36px, 11vw, 46px)',
            letterSpacing: '-0.04em',
          }}
        >
          Seus<br />passeios
        </h1>
        <p className="mt-3 text-[13px] max-w-[80%]" style={{ opacity: 0.6 }}>
          Histórico completo de aventuras com o seu pet.
        </p>
      </div>

      {/* KPIs */}
      {!loading && walks.length > 0 && (
        <div className="px-5 mb-5 grid grid-cols-3 gap-2">
          {[
            { label: 'Total', value: String(walks.length).padStart(2, '0') },
            { label: 'Minutos', value: String(totalMin) },
            { label: 'KM', value: totalKm.toFixed(1) },
          ].map((k) => (
            <div
              key={k.label}
              className="text-center py-3.5"
              style={{ background: PAPER, border: `1px solid ${INK}1A`, borderRadius: 18 }}
            >
              <p className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ opacity: 0.55 }}>
                {k.label}
              </p>
              <p
                className="text-[18px] font-bold mt-1"
                style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}
              >
                {k.value}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="px-5">
        {loading ? (
          <div className="py-16 flex justify-center">
            <div
              className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: `${INK}26`, borderTopColor: BRAND }}
            />
          </div>
        ) : walks.length === 0 ? (
          <div
            className="text-center py-14"
            style={{ border: `1px dashed ${INK}33`, borderRadius: 24 }}
          >
            <div
              className="w-14 h-14 rounded-full mx-auto flex items-center justify-center mb-4"
              style={{ background: BRAND, color: '#0B1410' }}
            >
              <Clock className="w-6 h-6" strokeWidth={2.2} />
            </div>
            <h3
              className="font-bold mb-1.5"
              style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 18, letterSpacing: '-0.01em' }}
            >
              Nenhum passeio ainda
            </h3>
            <p className="text-[12px]" style={{ opacity: 0.6 }}>
              Seus passeios aparecerão aqui.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {walks.map((walk) => {
              const petName = walk.pet?.name || 'Pet';
              const dur = walk.actual_duration_minutes || walk.planned_duration_minutes || 0;
              return (
                <button
                  key={walk.id}
                  onClick={() => navigate(`/historico/${walk.id}`)}
                  className="w-full flex items-center gap-3 active:scale-[0.99] transition-transform text-left"
                  style={{ background: PAPER, border: `1px solid ${INK}1A`, borderRadius: 22, padding: 12 }}
                >
                  <div
                    className="w-[60px] h-[60px] rounded-2xl flex-shrink-0 overflow-hidden flex items-center justify-center"
                    style={{ background: `${BRAND}26` }}
                  >
                    {walk.pet?.avatar_url ? (
                      <img src={walk.pet.avatar_url} alt={petName} className="w-full h-full object-cover" />
                    ) : (
                      <PawPrint className="w-6 h-6" style={{ color: '#0B1410' }} strokeWidth={2.2} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p
                        className="text-[15px] font-bold truncate"
                        style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.01em' }}
                      >
                        {petName}
                      </p>
                      {walk.rating ? (
                        <span className="flex items-center gap-0.5 text-[10px] font-bold" style={{ color: '#F5A524' }}>
                          <Star className="w-3 h-3 fill-current" />
                          {walk.rating}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11.5px] truncate" style={{ opacity: 0.7 }}>
                      {formatDate(walk.start_time || walk.created_at)} · {dur} min
                      {walk.distance_km && Number(walk.distance_km) > 0
                        ? ` · ${Number(walk.distance_km).toFixed(1)} km`
                        : ''}
                    </p>
                    <p className="text-[10.5px] truncate mt-0.5" style={{ opacity: 0.5 }}>
                      com {walk.walker_name || 'Pet Walker'}
                    </p>
                  </div>
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: BRAND, color: '#0B1410' }}
                  >
                    <ArrowUpRight className="w-4 h-4" strokeWidth={2.4} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default WalkHistory;