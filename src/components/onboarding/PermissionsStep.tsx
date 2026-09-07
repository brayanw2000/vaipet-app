import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { MapPin, Bell, Loader2, CheckCircle2, ChevronLeft } from 'lucide-react';

interface PermissionsStepProps {
  onNext: () => void;
  onBack?: () => void;
}

export const PermissionsStep: React.FC<PermissionsStepProps> = ({ onNext, onBack }) => {
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  const requestLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocalização não suportada.");
      return;
    }
    
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        setLocationEnabled(true);
        setLoading(false);
        toast.success("Localização ativada!");
      },
      (err) => {
        console.error(err);
        setLoading(false);
        toast.error("Permissão de localização negada.");
      }
    );
  };

  const requestNotifications = async () => {
    if (!("Notification" in window)) {
      toast.error("Este navegador não suporta notificações.");
      setNotificationsEnabled(true); // Mock for desktop if needed
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotificationsEnabled(true);
      toast.success("Notificações ativadas!");
    } else {
      toast.error("Permissão de notificação negada.");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-6 text-center relative">
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
          disabled={locationEnabled}
          className={`w-full h-20 flex items-center justify-between px-6 rounded-2xl transition-all border-2 ${
            locationEnabled ? 'bg-[#31D880]/10 border-[#31D880]' : 'bg-[#0B1410]/5 border-transparent'
          }`}
        >
          <div className="flex items-center gap-4 text-left">
            <div className={`p-2 rounded-xl ${locationEnabled ? 'bg-[#31D880] text-[#0B1410]' : 'bg-[#0B1410]/10 text-[#0B1410]/40'}`}>
              <MapPin className="w-6 h-6" />
            </div>
            <div>
              <p className="font-bold text-[#0B1410]">Localização</p>
              <p className="text-xs text-[#0B1410]/40">Obrigatório para o mapa</p>
            </div>
          </div>
          {locationEnabled && <CheckCircle2 className="text-[#31D880] w-6 h-6" />}
        </button>

        <button
          onClick={requestNotifications}
          disabled={notificationsEnabled}
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
              <p className="text-xs text-[#0B1410]/40">Alertas em tempo real</p>
            </div>
          </div>
          {notificationsEnabled && <CheckCircle2 className="text-[#31D880] w-6 h-6" />}
        </button>

        <Button
          onClick={onNext}
          disabled={!locationEnabled}
          className="w-full h-16 bg-[#0B1410] text-[#F7F5EF] rounded-2xl text-xl font-bold shadow-xl active:scale-95 transition-all mt-8"
        >
          {locationEnabled ? 'Continuar' : 'Ative a localização'}
        </Button>
      </div>
    </div>
  );
};