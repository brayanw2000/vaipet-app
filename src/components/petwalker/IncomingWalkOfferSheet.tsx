import React from 'react';
import { Button } from '@/components/ui/button';
import { BottomSheet } from './BottomSheet';
import { Clock, Target } from 'lucide-react';
import { Database } from '@/integrations/supabase/types';

type WalkOffer = Database['public']['Functions']['get_available_walk_offers']['Returns'][number];

interface IncomingWalkOfferSheetProps {
  offer: WalkOffer | null;
  onAccept: () => void;
  onDecline: () => void;
  actionLoading: 'accepting' | 'declining' | null;
}

export const IncomingWalkOfferSheet = ({ 
  offer, 
  onAccept, 
  onDecline,
  actionLoading 
}: IncomingWalkOfferSheetProps) => {
  if (!offer) return null;

  const totalValue = (offer.total_price_cents || 0) / 100;
  const distance = Math.round(offer.distance_meters || 0);
  
  // Format schedule
  const isScheduled = offer.request_mode === 'scheduled';
  const scheduleText = isScheduled ? "Agendado" : "Agora";

  return (
    <BottomSheet 
      isOpen={true} 
      isHighPriority={true} 
      className="h-[65vh]" 
      dismissible={false}
      navigationOffset={false}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div className="space-y-1">
            <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-green-100 text-[#31D880] text-[10px] font-black uppercase tracking-wider border border-green-200">
              Nova solicitação
            </div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">{scheduleText}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-black text-ink leading-none tracking-tighter">R$ {totalValue.toFixed(2)}</p>
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Valor do passeio</p>
          </div>
        </div>

        {/* Main Info */}
        <div className="space-y-6 flex-1 overflow-y-auto pr-2 pb-4">
          <div className="space-y-1">
            <h4 className="text-3xl font-black font-space text-ink tracking-tight leading-none">{offer.pet_name}</h4>
            <p className="text-muted-foreground font-bold">Solicitação de passeio</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
               <Clock className="text-[#31D880] mb-2" size={20} />
               <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Duração</p>
               <p className="text-lg font-black text-ink">{offer.duration_minutes} min</p>
            </div>
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
               <Target className="text-[#31D880] mb-2" size={20} />
               <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Distância</p>
               <p className="text-lg font-black text-ink">{distance}m</p>
            </div>
          </div>

          <div className="space-y-4 pt-2">
             <div className="flex gap-4">
               <div className="flex flex-col items-center">
                 <div className="w-3 h-3 rounded-full border-2 border-[#31D880] bg-white z-10" />
                 <div className="w-0.5 h-10 bg-gray-100 my-1" />
                 <div className="w-3 h-3 rounded-full bg-ink z-10" />
               </div>
               <div className="flex flex-col justify-between py-0.5 text-sm font-bold">
                  <div className="space-y-0.5">
                    <p className="text-ink">Encontro com o pet</p>
                    <p className="text-[11px] text-muted-foreground">{distance ? `${distance}m de você` : 'Próximo a você'}</p>
                  </div>
                  <p className="text-muted-foreground">Passeio de {offer.duration_minutes} min</p>
               </div>
             </div>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 space-y-3 bg-white">
          <Button 
            onClick={onAccept}
            disabled={actionLoading !== null}
            data-testid="walker-accept-button"
            className="w-full bg-[#31D880] text-ink hover:bg-[#2bc473] h-14 rounded-2xl font-black text-xl shadow-xl active:scale-95 transition-all"
          >
            {actionLoading === 'accepting' ? 'Confirmando...' : 'ACEITAR PASSEIO'}
          </Button>
          <button 
            onClick={onDecline}
            disabled={actionLoading !== null}
            className="w-full text-sm font-bold text-muted-foreground py-2 hover:text-ink transition-colors disabled:opacity-50"
          >
            {actionLoading === 'declining' ? 'Recusando...' : 'Recusar'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
};