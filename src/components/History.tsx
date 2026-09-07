import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

import { WalkStatus } from '@/types/walk';

interface WalkSession {
  id: string;
  start_time: string;
  planned_duration_minutes: number;
  actual_duration_minutes: number | null;
  current_status: WalkStatus;
  walker_name: string | null;
  pets: { name: string; avatar_url: string | null } | null;
}

export const History = () => {
  const { user } = useAuth();
  const [walkSessions, setWalkSessions] = useState<WalkSession[]>([]);

  useEffect(() => {
    if (user) fetchHistory();
  }, [user]);

  const fetchHistory = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('walk_sessions')
        .select(`id, start_time, planned_duration_minutes, actual_duration_minutes, current_status, walker_name, pets(name, avatar_url)`)
        .eq('customer_id', user.id)
        .eq('current_status', 'completed')
        .order('start_time', { ascending: false })
        .limit(5);
      if (!error && data) setWalkSessions(data);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  return (
    <div className="px-5 pb-28">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Histórico</h2>
        {walkSessions.length > 0 && (
          <button className="text-xs font-semibold" style={{ color: '#F14A00' }}>Ver tudo</button>
        )}
      </div>

      {walkSessions.length === 0 ? (
        <div className="text-center py-8 bg-card rounded-2xl border border-border/50">
          <div 
            className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
            style={{ backgroundColor: '#F3EEF8' }}
          >
            <Clock className="w-5 h-5" style={{ color: '#664898' }} />
          </div>
          <p className="text-muted-foreground text-xs font-semibold">Nenhum passeio ainda</p>
          <p className="text-muted-foreground/50 text-[11px] mt-0.5">Seus passeios aparecerão aqui</p>
        </div>
      ) : (
        <div className="space-y-2">
          {walkSessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center gap-3 p-3.5 bg-card rounded-2xl border border-border/50"
            >
              <div 
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: '#FFF5F0' }}
              >
                <Clock className="w-4 h-4" style={{ color: '#F14A00' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-foreground truncate">
                  {session.pets?.name || 'Passeio'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {session.actual_duration_minutes || session.planned_duration_minutes} min
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground font-medium">{formatDate(session.start_time)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
