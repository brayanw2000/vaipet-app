import React from 'react';
import { Locate, LocateOff, Navigation } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PetwalkerGpsStatusProps {
  gpsStatus: 'requesting' | 'synced' | 'unstable' | 'stale' | 'denied' | 'error';
  lastSync: Date | null;
  className?: string;
}

export const PetwalkerGpsStatus = ({ gpsStatus, lastSync, className }: PetwalkerGpsStatusProps) => {
  const isSyncing = !lastSync || (new Date().getTime() - lastSync.getTime() > 30000);

  if (gpsStatus === 'denied' || gpsStatus === 'error') {
    return (
      <div className={cn("flex items-center gap-1.5 text-[11px] font-medium text-red-500", className)}>
        <LocateOff size={12} />
        <span>GPS desativado</span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center justify-between text-[11px] text-muted-foreground font-medium px-1", className)}>
      <div className="flex items-center gap-1.5">
        <Locate size={12} className={cn(gpsStatus === 'synced' ? "text-[#31D880]" : "text-orange-400")} />
        <span>{gpsStatus === 'synced' ? 'Localização ativa' : 'GPS instável'}</span>
      </div>
      <span>
        {lastSync 
          ? `Sincronizado ${lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` 
          : 'Sincronizando...'}
      </span>
    </div>
  );
};