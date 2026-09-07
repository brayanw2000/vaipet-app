import { createContext, useContext } from 'react';

export type GpsStatus = 'requesting' | 'synced' | 'unstable' | 'stale' | 'denied' | 'error';

export interface PetwalkerGpsContextType {
  coords: [number, number] | null;
  accuracy: number | null;
  status: GpsStatus;
  lastSync: Date | null;
  retry: () => void;
  isOnline: boolean;
}


export const PetwalkerGpsContext = createContext<PetwalkerGpsContextType | undefined>(undefined);

export const usePetwalkerGpsContext = () => {
  const context = useContext(PetwalkerGpsContext);
  if (context === undefined) {
    throw new Error('usePetwalkerGpsContext must be used within a PetwalkerGpsProvider');
  }
  return context;
};
