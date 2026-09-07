import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PawPrint, ChevronRight, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { BETA_WALKER_AVATAR, BETA_WALKER_NAME } from '@/lib/walkerProfile';

import { WalkStatus } from '@/types/walk';

interface ActiveWalk {
  id: string;
  pet_id: string;
  walker_name: string;
  current_status: WalkStatus;
  start_time: string;
  planned_duration_minutes: number;
  pet_name?: string;
  pet_avatar?: string;
}

export const ActiveWalkBanner: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeWalk, setActiveWalk] = useState<ActiveWalk | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!user) return;
    const fetchActiveWalk = async () => {
      const { data } = await supabase
        .from('walk_sessions')
        .select('id, pet_id, walker_name, current_status, start_time, planned_duration_minutes')
        .eq('customer_id', user.id)
        .in('current_status', ['in_progress', 'returning'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        // Safety net: a walk should never run forever. If the elapsed time
        // since `start_time` exceeds the planned duration by more than the
        // grace window (15 min), the session was clearly abandoned.
        // We do NOT auto-finalize here via direct update. Abandoned sessions
        // should be handled by a secure administrative routine or the walker.
        const startedAt = new Date(data.start_time).getTime();
        const plannedMin = data.planned_duration_minutes || 30;
        const elapsedMin = (Date.now() - startedAt) / 60000;
        const GRACE_MIN = 15;
        if (elapsedMin > plannedMin + GRACE_MIN) {
          // Note: While the walk has exceeded its planned duration, 
          // we DO NOT hide it if it's still marked as in_progress or returning.
          // This ensures visibility for abandoned or delayed sessions.
          // The label or status should reflect the delay.
          // We only return here if we wanted to hide it, but the user requested persistence.
        }

        // Fetch pet info
        const { data: pet } = await supabase
          .from('pets')
          .select('name, avatar_url')
          .eq('id', data.pet_id)
          .single();

        setActiveWalk({
          ...data,
          pet_name: pet?.name,
          pet_avatar: pet?.avatar_url || undefined,
        });
      } else {
        setActiveWalk(null);
      }
    };

    fetchActiveWalk();

    // Subscribe to changes
    const channel = supabase
      .channel('active-walk-banner')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'walk_sessions',
        filter: `customer_id=eq.${user.id}`,
      }, () => fetchActiveWalk())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Timer
  useEffect(() => {
    if (!activeWalk) return;
    const interval = setInterval(() => {
      const raw = Math.floor((Date.now() - new Date(activeWalk.start_time).getTime()) / 1000);
      // Cap the displayed timer at the planned duration so users never see
      // absurd values like "880 min" if the session somehow lingers.
      const cap = (activeWalk.planned_duration_minutes || 30) * 60;
      setElapsed(Math.min(raw, cap));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeWalk]);

  if (!activeWalk) return null;

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="px-5 mb-4">
      <button
        onClick={() => navigate(`/search-walk?resume=${activeWalk.id}`)}
        className="w-full rounded-2xl p-4 flex items-center gap-3 active:scale-[0.98] transition-transform border border-accent/20"
        style={{
          background: 'linear-gradient(135deg, hsl(159 100% 33% / 0.08), hsl(159 100% 33% / 0.03))',
        }}
      >
        {/* Pet avatar or icon */}
        <div className="relative flex-shrink-0 flex items-center">
          {activeWalk.pet_avatar ? (
            <div className="w-12 h-12 rounded-xl overflow-hidden border-2 border-accent/30">
              <img src={activeWalk.pet_avatar} alt="" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center border-2 border-accent/30">
              <PawPrint className="w-5 h-5 text-accent" />
            </div>
          )}
          {/* Walker avatar peeks from the pet (overlapping ring) */}
          <div className="w-9 h-9 -ml-3 rounded-full overflow-hidden border-2 border-background shadow-sm">
            <img src={BETA_WALKER_AVATAR} alt={BETA_WALKER_NAME} className="w-full h-full object-cover" />
          </div>
          <div className="absolute -top-1 right-0 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-background animate-pulse" />
        </div>

        {/* Info */}
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-extrabold text-foreground">
            {activeWalk.current_status === 'in_progress' && elapsed > activeWalk.planned_duration_minutes * 60 
              ? 'Tempo previsto excedido' 
              : 'Passeio em andamento'}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-muted-foreground font-medium">
              {activeWalk.pet_name || 'Seu pet'} com {BETA_WALKER_NAME}
            </span>
          </div>
        </div>

        {/* Timer & arrow */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/10">
            <Clock className="w-3 h-3 text-accent" />
            <span className="text-xs font-bold text-accent">{fmt(elapsed)}</span>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      </button>
    </div>
  );
};
