import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ArrowLeft, User, Calendar, Clock, MapPin, PawPrint, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const slugify = (name: string) => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

export const PetHistory = () => {
  const { name: petSlug } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pet, setPet] = useState<any>(null);
  const [walkHistory, setWalkHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (petSlug && user) fetchPetAndHistory();
  }, [petSlug, user]);

  const fetchPetAndHistory = async () => {
    try {
      setLoading(true);
      const { data: allPets } = await supabase.from('pets').select('*').eq('owner_id', user?.id).eq('is_active', true);
      const found = allPets?.find(p => slugify(p.name) === petSlug);
      
      if (!found) {
        navigate('/');
        return;
      }
      setPet(found);

      const { data: walkData } = await supabase
        .from('walk_sessions')
        .select('*')
        .eq('pet_id', found.id)
        .eq('current_status', 'completed')
        .order('created_at', { ascending: false });

      setWalkHistory((walkData || []).map(s => ({
        ...s,
        provider: { full_name: s.walker_name || 'Pet Walker' },
        total_price: s.total_price_cents ? s.total_price_cents / 100 : 0,
      })));
    } catch {
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Ontem';
    if (diff < 7) return `Há ${diff} dias`;
    return d.toLocaleDateString('pt-BR');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!pet) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Pet não encontrado</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto">
      {/* Header */}
      <div className="px-4 pt-8 pb-4 flex items-center gap-3">
        <button onClick={() => navigate(`/pet/${petSlug}`)} className="w-10 h-10 rounded-full bg-card border border-border/40 flex items-center justify-center active:scale-95 transition-transform">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div>
          <h1 className="text-lg font-extrabold text-foreground">Histórico</h1>
          <p className="text-xs text-muted-foreground font-medium">{pet.name}</p>
        </div>
      </div>

      <div className="px-5 pb-8">
        {walkHistory.length > 0 ? (
          <div className="space-y-2">
            {walkHistory.map((walk) => (
              <button
                key={walk.id}
                onClick={() => navigate(`/pet/${petSlug}/history/${walk.id}`)}
                className="w-full flex items-center gap-3 p-3.5 bg-card rounded-2xl border border-border/40 active:scale-[0.98] transition-transform text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <PawPrint className="w-5 h-5 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground">
                    {walk.provider?.full_name || walk.walker_name || 'Pet Walker'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDate(walk.start_time || walk.created_at)} • {walk.actual_duration_minutes || walk.planned_duration_minutes} min
                    {walk.distance_km > 0 && ` • ${Number(walk.distance_km).toFixed(1)} km`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-extrabold text-foreground">R$ {walk.total_price?.toFixed(0)}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-card rounded-2xl border border-border/40">
            <Clock className="w-10 h-10 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground font-medium">Nenhum passeio realizado</p>
            <p className="text-xs text-muted-foreground/60 mt-1">O histórico aparecerá após o primeiro passeio</p>
          </div>
        )}
      </div>
    </div>
  );
};
