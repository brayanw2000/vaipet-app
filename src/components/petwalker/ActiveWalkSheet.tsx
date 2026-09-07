import React from 'react';
import { Button } from '@/components/ui/button';
import { BottomSheet } from './BottomSheet';
import { MapPin, Navigation } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Database } from '@/integrations/supabase/types';
import { supabase } from "@/integrations/supabase/client";

type WalkSession = Database['public']['Tables']['walk_sessions']['Row'] & {
  customer?: { full_name: string | null };
  pet?: { name: string; avatar_url: string | null; breed: string | null };
};

interface ActiveWalkSheetProps {
  activeRequest: WalkSession | null;
}

export const ActiveWalkSheet = ({ activeRequest }: ActiveWalkSheetProps) => {
  const navigate = useNavigate();

  if (!activeRequest) return null;

  const status = activeRequest.current_status;
  const isInProgress = status === 'in_progress';

  return (
    <BottomSheet 
      isOpen={true} 
      navigationOffset={false}
      dismissible={false}
      className={cn(isInProgress ? "bg-ink text-white" : "bg-white")}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-2 h-2 rounded-full",
              status === 'in_progress' ? "bg-[#31D880] animate-pulse" : "bg-blue-500"
            )} />
            <h3 className={cn(
              "text-lg font-bold font-space uppercase tracking-tight", 
              isInProgress ? "text-white" : "text-ink"
            )}>
              {status === 'accepted' && 'Passeio confirmado'}
              {status === 'heading_to_pickup' && 'A caminho do pet'}
              {status === 'arrived' && 'Você chegou'}
              {status === 'in_progress' && 'Passeio em andamento'}
            </h3>
          </div>
          <div className={cn(
            "px-3 py-1 rounded-full text-[10px] font-black uppercase", 
            isInProgress ? "bg-white/10 text-white" : "bg-gray-100 text-muted-foreground"
          )}>
             {activeRequest.planned_duration_minutes} min
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-[22px] overflow-hidden bg-gray-100 border-2 border-white shadow-sm">
             {activeRequest.pet?.avatar_url ? (
               <img src={activeRequest.pet.avatar_url} alt="Pet" className="w-full h-full object-cover" />
             ) : (
               <div className="w-full h-full flex items-center justify-center text-gray-400 text-2xl">🐾</div>
             )}
          </div>
          <div>
             <h4 className={cn(
               "text-2xl font-black font-space leading-none", 
               isInProgress ? "text-white" : "text-ink"
             )}>
               {activeRequest.pet?.name || 'Pet'}
             </h4>
             <p className={cn(
               "text-sm font-bold mt-1", 
               isInProgress ? "text-white/60" : "text-muted-foreground"
             )}>
               {activeRequest.customer?.full_name}
             </p>
          </div>
        </div>

        {!isInProgress && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm">
              <MapPin size={16} className="text-[#31D880] mt-0.5 shrink-0" />
              <p className={cn("font-bold leading-tight", isInProgress ? "text-white" : "text-ink")}>
                {activeRequest.meeting_point_address || 'Endereço do encontro'}
              </p>
            </div>
            <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground px-1">
               <div className="flex items-center gap-1">
                 <Navigation size={12} />
                 <span>{activeRequest.distance_km ? `${Number(activeRequest.distance_km).toFixed(1)} km` : 'Calculando rota...'}</span>
               </div>
               <span className={cn("font-black tracking-tight", isInProgress ? "text-white" : "text-ink")}>
                 R$ {((activeRequest.total_price_cents || 0)/100).toFixed(2)}
               </span>
            </div>
          </div>
        )}

        <Button 
          onClick={async () => {
            if (status === 'accepted') {
              const { error } = await supabase.rpc('petwalker_start_heading', { _session_id: activeRequest.id });
              if (error) {
                console.error('Error starting heading:', error);
                return;
              }
            } else if (status === 'heading_to_pickup') {
              // Get current position
              navigator.geolocation.getCurrentPosition(async (pos) => {
                const { error } = await supabase.rpc('petwalker_arrive_pickup', { 
                  _session_id: activeRequest.id,
                  _lat: pos.coords.latitude,
                  _lng: pos.coords.longitude,
                  _accuracy: pos.coords.accuracy
                });
                if (error) {
                  console.error('Error arriving at pickup:', error);
                  return;
                }
              }, (err) => console.error('GPS error:', err));
              return;
            }
            navigate(`/petwalker/passeio/${activeRequest.id}`);
          }}
          className={cn(
            "w-full h-14 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all",
            isInProgress ? "bg-[#31D880] text-ink hover:bg-[#2bc473]" : "bg-ink text-white hover:bg-ink/90"
          )}
        >
          {status === 'accepted' && 'Iniciar deslocamento'}
          {status === 'heading_to_pickup' && 'Cheguei ao local'}
          {status === 'arrived' && 'Validar PIN'}
          {status === 'in_progress' && 'Gerenciar Passeio'}
        </Button>
      </div>
    </BottomSheet>
  );
};