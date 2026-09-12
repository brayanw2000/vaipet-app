import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { MapPin, Bell, Loader2, CheckCircle2, ChevronLeft } from 'lucide-react';

interface PermissionsStepProps {
  onNext: () => void;
  onBack?: () => void;
}

// Estados diferenciados da permissão de localização:
// aguardando → solicitando → autorizada | negada | indisponível/erro.
type LocationState = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';

const LOCATION_DENIED_MESSAGE =
  'Localização não autorizada. Você pode continuar e ativar depois nos ajustes.';
const LOCATION_UNAVAILABLE_MESSAGE =
  'Localização indisponível neste dispositivo. Você pode continuar e ativar depois nos ajustes.';

export const PermissionsStep: React.FC<PermissionsStepProps> = ({ onNext, onBack }) => {
  const [locationState, setLocationState] = useState<LocationState>('idle');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  // Guarda contra cliques duplicados enquanto a solicitação está em andamento.
  const locationRequestingRef = useRef(false);
  const notificationsRequestingRef = useRef(false);

  const requestLocation = () => {
    if (locationRequestingRef.current || locationState === 'granted') return;

    // Sem suporte: usuário pode avançar — a localização é solicitada
    // novamente quando recursos como mapa e passeio forem usados.
    if (!navigator.geolocation) {
      setLocationState('unavailable');
      return;
    }

    locationRequestingRef.current = true;
    setLocationState('requesting');
    navigator.geolocation.getCurrentPosition(
      () => {
        locationRequestingRef.current = false;
        setLocationState('granted');
        toast.success('Localização ativada!');
      },
      (err) => {
        locationRequestingRef.current = false;
        // code 1 = PERMISSION_DENIED; 2/3 (indisponível/timeout) e erros
        // genéricos entram no estado "unavailable".
        setLocationState(err?.code === 1 ? 'denied' : 'unavailable');
      }
    );
  };

  const requestNotifications = async () => {
    if (notificationsRequestingRef.current || notificationsEnabled) return;

    if (!('Notification' in window)) {
      // Sem suporte: nunca bloqueia o avanço.
      toast.error('Este navegador não suporta notificações.');
      return;
    }

    notificationsRequestingRef.current = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setNotificationsEnabled(true);
        toast.success('Notificações ativadas!');
      } else {
        toast.error('Permissão de notificação negada.');
      }
    } finally {
      notificationsRequestingRef.current = false;
    }
  };

  const locationDeniedOrUnavailable =
    locationState === 'denied' || locationState === 'unavailable';

  return (
    <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col items-center px-6 pt-20 pb-[max(2.5rem,env(safe-area-inset-bottom))] text-center relative">
      {onBack && (
        <button 
          onClick={onBack}
          className="absolute top-12 left-0 p-2 text-[#0B1410] hover:bg-[#0B1410]/5 rounded-full transition-colors"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}
      <div className="mb-8 p-3 bg-[#31D880]/10 rounded-2xl">
        <Bell className="w-8 h-8 text-[#31D880]" />
      </div>

      <h2 className="text-3xl font-bold text-[#0B1410] mb-4 font-display">
        Permissões
      </h2>
      <p className="text-[#0B1410]/60 mb-10 max-w-[280px]">
        Precisamos de acesso para enviar passeadores até você e te avisar sobre o status.
      </p>

      <div className="w-full max-w-sm space-y-4">
        <button
          onClick={requestLocation}
          disabled={locationState === 'requesting' || locationState === 'granted'}
          data-testid="location-card"
          className={`w-full h-20 flex items-center justify-between px-6 rounded-2xl transition-all border-2 ${
            locationState === 'granted'
              ? 'bg-[#31D880]/10 border-[#31D880]'
              : locationDeniedOrUnavailable
                ? 'bg-[#0B1410]/5 border-[#F14A00]/40'
                : 'bg-[#0B1410]/5 border-transparent'
          }`}
        >
          <div className="flex items-center gap-4 text-left">
            <div className={`p-2 rounded-xl ${locationState === 'granted' ? 'bg-[#31D880] text-[#0B1410]' : 'bg-[#0B1410]/10 text-[#0B1410]/40'}`}>
              <MapPin className="w-6 h-6" />
            </div>
            <div>
              <p className="font-bold text-[#0B1410]">Localização</p>
              <p className="text-xs text-[#0B1410]/40">Necessário somente ao usar o mapa</p>
            </div>
          </div>
          {locationState === 'requesting' ? (
            <Loader2 className="text-[#0B1410]/40 w-6 h-6 animate-spin" />
          ) : (
            locationState === 'granted' && <CheckCircle2 className="text-[#31D880] w-6 h-6" />
          )}
        </button>

        {locationState === 'denied' && (
          <p role="alert" data-testid="location-message" className="text-sm text-[#F14A00] px-2">
            {LOCATION_DENIED_MESSAGE}
          </p>
        )}
        {locationState === 'unavailable' && (
          <p role="alert" data-testid="location-message" className="text-sm text-[#0B1410]/60 px-2">
            {LOCATION_UNAVAILABLE_MESSAGE}
          </p>
        )}

        <button
          onClick={requestNotifications}
          disabled={notificationsEnabled}
          data-testid="notifications-card"
          className={`w-full h-20 flex items-center justify-between px-6 rounded-2xl transition-all border-2 ${
            notificationsEnabled ? 'bg-[#31D880]/10 border-[#31D880]' : 'bg-[#0B1410]/5 border-transparent'
          }`}
        >
          <div className="flex items-center gap-4 text-left">
            <div className={`p-2 rounded-xl ${notificationsEnabled ? 'bg-[#31D880] text-[#0B1410]' : 'bg-[#0B1410]/10 text-[#0B1410]/40'}`}>
              <Bell className="w-6 h-6" />
            </div>
            <div>
              <p className="font-bold text-[#0B1410]">Notificações</p>
              <p className="text-xs text-[#0B1410]/40">Opcional — alertas em tempo real</p>
            </div>
          </div>
          {notificationsEnabled && <CheckCircle2 className="text-[#31D880] w-6 h-6" />}
        </button>

        {/* O avanço nunca é bloqueado: autorizada → "Continuar"; caso contrário
            → "Continuar sem localização" (negada, indisponível, não suportada,
            timeout ou enquanto a solicitação está em andamento). */}
        <Button
          onClick={onNext}
          data-testid="continue-permissions"
          className="w-full h-16 bg-[#0B1410] text-[#F7F5EF] rounded-2xl text-xl font-bold shadow-xl active:scale-95 transition-all mt-8"
        >
          {locationState === 'granted' ? 'Continuar' : 'Continuar sem localização'}
        </Button>
      </div>
    </div>
  );
};
