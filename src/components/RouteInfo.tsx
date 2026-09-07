import React from 'react';
import { Clock, MapPin } from 'lucide-react';

interface RouteInfoProps {
  duration: number;
  distance: number;
  isVisible: boolean;
}

export const RouteInfo: React.FC<RouteInfoProps> = ({ duration, distance, isVisible }) => {
  if (!isVisible) return null;

  return (
    <div className="absolute top-20 left-4 right-4 z-20 animate-fade-in">
      <div className="bg-card rounded-2xl p-4 border border-border/60" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(49, 216, 128,0.08)' }}>
              <MapPin className="w-5 h-5" style={{ color: '#31d880' }} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Distância</p>
              <p className="text-sm font-bold text-foreground">{distance.toFixed(1)} km</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">{duration} min</span>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#31d880' }} />
          <span className="text-xs text-muted-foreground font-medium">Passeador a caminho</span>
        </div>
      </div>
    </div>
  );
};
