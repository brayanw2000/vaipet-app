import React, { useEffect, useState, useRef } from 'react';
import { X, Star, MapPin, Shield, PawPrint } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import { hideMapLabels, enrichMap, tintMapInk } from '@/lib/mapStyle';
import 'mapbox-gl/dist/mapbox-gl.css';

import { Dialog, DialogContent } from '@/components/ui/dialog';

interface WaitingForAcceptanceProps {
  onTimeout: () => void;
  onCancel: () => void;
  isDarkMode?: boolean;
  userLocation?: [number, number] | null;
  walkerData?: {
    name: string;
    avatar_url: string;
    rating?: number;
    completed_walks?: number;
  } | null;
  matchingExpiresAt?: string | null;
}


export const WaitingForAcceptance: React.FC<WaitingForAcceptanceProps> = ({ 
  onTimeout, onCancel,
  isDarkMode = false,
  userLocation = null,
  walkerData = null,
  matchingExpiresAt = null
}) => {
  const petwalkerName = walkerData?.name || "Buscando...";
  const petwalkerAvatar = walkerData?.avatar_url || "https://upload.wikimedia.org/wikipedia/commons/b/bf/Foto_Perfil_.jpg";
  const petwalkerRating = walkerData?.rating || 5.0;
  const petwalkerWalks = walkerData?.completed_walks || 0;

  const [timeLeft, setTimeLeft] = useState(300);
  const [showProfile, setShowProfile] = useState(false);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || !userLocation || map.current) return;
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/standard",
      center: userLocation,
      zoom: 15.6,
      pitch: 45,
      interactive: false,
      attributionControl: false,
      config: {
        basemap: {
          lightPreset: isDarkMode ? "night" : "day",
          theme: isDarkMode ? "default" : "faded",
          show3dObjects: false,
          showPointOfInterestLabels: false,
          showTransitLabels: false,
          showAdminBoundaries: false,
          showPlaceLabels: true,
          showRoadLabels: true,
          showPedestrianRoads: true,
          colorLand: "#F2F1E8",
          colorWater: "#D5E8E5",
          colorGreenspace: "#C5DEBC",
          colorRoads: "#FFFFFF",
          colorTrunks: "#F5EEDB",
          colorMotorways: "#EEE4C8",
          colorBuildings: "#E6E3D8",
          colorRoadLabels: "#84908A",
          colorPlaceLabels: "#46534D"
        }
      }
    });

    map.current.on('load', () => {
      if (!map.current) return;
      hideMapLabels(map.current);
      enrichMap(map.current, !isDarkMode);
      tintMapInk(map.current, isDarkMode);
    });

    return () => { map.current?.remove(); map.current = null; };
  }, [userLocation, isDarkMode]);


  useEffect(() => {
    const timer = setInterval(() => {
      if (!matchingExpiresAt) return;
      
      const expiry = new Date(matchingExpiresAt).getTime();
      const now = Date.now();
      const diff = Math.max(0, Math.floor((expiry - now) / 1000));
      
      setTimeLeft(diff);
      
      if (diff <= 0) {
        clearInterval(timer);
        onTimeout();
      }
    }, 1000);
    
    return () => clearInterval(timer);
  }, [onTimeout, matchingExpiresAt]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  // Minimal floating top pill — same clean language as the walking phase.
  // No bottom sheet: the map stays 100% fullscreen.
  const R = 22;
  const C = 2 * Math.PI * R;
  const dash = ((300 - timeLeft) / 300) * C;

  const chrome = isDarkMode
    ? { bg: '#0B1410', border: '1px solid rgba(255,255,255,0.08)', text: '#F5F5F5', muted: 'rgba(255,255,255,0.55)', shadow: '0 8px 24px rgba(0,0,0,0.55)', xBg: 'rgba(255,255,255,0.08)' }
    : { bg: 'rgba(255,255,255,0.92)', border: '1px solid rgba(0,0,0,0.06)', text: '#0F172A', muted: 'rgba(0,0,0,0.55)', shadow: '0 8px 24px rgba(0,0,0,0.18)', xBg: 'rgba(0,0,0,0.06)' };

  return (
    <>
      <div ref={mapContainer} className="absolute inset-0 z-0" />

      <div
        className="absolute left-1/2 z-30 animate-pill-in pointer-events-auto"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)', transform: 'translateX(-50%)' }}
      >
        <div
          onClick={() => setShowProfile(true)}
          className="flex items-center gap-3.5 backdrop-blur-md rounded-full pl-2 pr-3 py-2 transition-all duration-500 ease-out cursor-pointer min-w-[260px]"
          style={{ background: chrome.bg, border: chrome.border, boxShadow: chrome.shadow }}
        >
          {/* Avatar inside countdown ring */}
          <div className="relative w-[60px] h-[60px] flex items-center justify-center">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 60 60" width="60" height="60">
              <circle cx="30" cy="30" r={R} fill="none" stroke={isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'} strokeWidth="3" />
              <circle
                cx="30" cy="30" r={R} fill="none"
                stroke="#31d880" strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${dash} ${C}`}
                style={{ transition: 'stroke-dasharray 1s linear' }}
              />
            </svg>
            <div className="w-12 h-12 rounded-full overflow-hidden border-2" style={{ borderColor: isDarkMode ? '#1a1a1a' : '#fff' }}>
              <img src={petwalkerAvatar} alt={petwalkerName} className="w-full h-full object-cover" />
            </div>
          </div>

          <div className="flex flex-col leading-tight pr-2 flex-1">
            <span className="text-[12px] font-semibold" style={{ color: chrome.muted }}>Aguardando</span>
            <span className="text-[15px] font-extrabold tabular-nums whitespace-nowrap" style={{ color: chrome.text }}>
              {timeLeft <= 0 ? 'Expirado' : `${petwalkerName} • ${formatTime(timeLeft)}`}
            </span>
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            className="ml-auto w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-all shrink-0"
            style={{ background: chrome.xBg }}
            aria-label="Cancelar"
          >
            <X className="w-[18px] h-[18px]" style={{ color: chrome.text }} />
          </button>
        </div>
      </div>

      {/* Walker Profile Dialog */}
      <Dialog open={showProfile} onOpenChange={setShowProfile}>
        <DialogContent className="rounded-[24px] max-w-sm mx-auto p-0 overflow-hidden">
          {/* Profile header */}
          <div className="relative bg-accent/10 pt-8 pb-6 flex flex-col items-center">
            <div className="relative">
              <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-card shadow-lg">
                <img src={petwalkerAvatar} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="absolute bottom-1 right-1 w-5 h-5 rounded-full border-2 border-card" style={{ backgroundColor: 'hsl(142, 71%, 45%)' }} />
            </div>
            <h3 className="text-xl font-bold text-foreground mt-3">{petwalkerName}</h3>
            <p className="text-sm text-muted-foreground">Petwalker profissional</p>
            <div className="flex items-center gap-1 mt-2">
              {[1,2,3,4,5].map(i => <Star key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400" />)}
              <span className="text-sm font-bold text-foreground ml-1">{petwalkerRating}</span>
              <span className="text-xs text-muted-foreground">({petwalkerWalks} avaliações)</span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 px-5 py-4">
            {[
              { label: 'Passeios', value: petwalkerWalks.toString() },
              { label: 'Experiência', value: '2 anos' },
              { label: 'Taxa resp.', value: '98%' },
            ].map((stat, i) => (
              <div key={i} className="text-center py-3 rounded-xl bg-background border border-border/60">
                <p className="text-lg font-bold text-foreground">{stat.value}</p>
                <p className="text-[10px] text-muted-foreground font-medium">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Info */}
          <div className="px-5 pb-5 space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-background border border-border/60">
              <MapPin className="w-4 h-4 text-accent flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Região</p>
                <p className="text-sm font-semibold text-foreground">Centro, São Paulo</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-background border border-border/60">
              <Shield className="w-4 h-4 text-green-500 flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Verificação</p>
                <p className="text-sm font-semibold text-foreground">Identidade verificada ✓</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-background border border-border/60">
              <PawPrint className="w-4 h-4 text-accent flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Especialidade</p>
                <p className="text-sm font-semibold text-foreground">Cães de pequeno e médio porte</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
