import React from 'react';
import { Button } from '@/components/ui/button';
import { BottomSheet } from './BottomSheet';
import { useNavigate } from 'react-router-dom';
import { Navigation } from 'lucide-react';
import { PetwalkerGpsStatus } from './PetwalkerGpsStatus';

interface PetwalkerStatusSheetProps {
  isOnline: boolean;
  onToggleOnline: () => void;
  gpsStatus: 'requesting' | 'synced' | 'unstable' | 'stale' | 'denied' | 'error';
  lastSync: Date | null;
  onRetryGps: () => void;
}

export const PetwalkerStatusSheet = ({ 
  isOnline, 
  onToggleOnline, 
  gpsStatus, 
  lastSync,
  onRetryGps
}: PetwalkerStatusSheetProps) => {
  const navigate = useNavigate();

  if (gpsStatus === 'denied' || gpsStatus === 'error') {
    return (
      <BottomSheet isOpen={true} navigationOffset={false} dismissible={true}>
        <div className="space-y-6 py-2">
          <div className="flex items-center gap-4 bg-red-50 p-4 rounded-2xl border border-red-100">
            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-red-500 shadow-sm">
              <Navigation size={24} />
            </div>
            <div>
              <h3 className="text-ios-headline font-bold text-red-900">Ative sua localização</h3>
              <p className="text-ios-caption-1 text-red-700 leading-tight">Precisamos do seu GPS para você receber solicitações de passeio.</p>
            </div>
          </div>
          
          <div className="space-y-3">
            <Button 
              onClick={onRetryGps}
              className="w-full bg-foreground text-background"
            >
              Tentar novamente
            </Button>
            <button className="w-full text-sm font-bold text-muted-foreground py-2">Como permitir a localização</button>
          </div>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet isOpen={true} navigationOffset={true} dismissible={true}>
      {!isOnline ? (
        <div className="space-y-6">
          <div className="text-center space-y-1">
            <h3 className="text-ios-title-2 font-bold text-foreground">Você está offline</h3>
            <p className="text-ios-subheadline text-muted-foreground">Fique online para receber solicitações de passeio próximas</p>
          </div>
          <Button 
            onClick={onToggleOnline} 
            className="w-full bg-primary text-primary-foreground text-ios-headline"
          >
            Ficar Online
          </Button>
          <button 
            onClick={() => navigate('/petwalker/historico')}
            className="w-full text-sm font-bold text-muted-foreground hover:text-ink transition-colors pb-2"
          >
            Ver histórico
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <h3 className="text-ios-headline font-bold text-foreground">Você está online</h3>
            </div>
            <button onClick={onToggleOnline} className="text-sm font-bold text-red-500 px-2 py-1">Ficar offline</button>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center gap-3 bg-muted/30 p-4 rounded-xl border border-separator">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary">
                <Navigation size={18} className="animate-pulse" />
              </div>
              <div>
                <p className="text-ios-subheadline font-bold text-foreground">Procurando solicitações...</p>
                <p className="text-ios-caption-2 text-muted-foreground font-medium">As solicitações aparecerão aqui automaticamente</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </BottomSheet>
  );
};