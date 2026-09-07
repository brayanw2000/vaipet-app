import { usePetwalkerGpsContext, GpsStatus } from '@/contexts/PetwalkerGpsContext';

export type { GpsStatus };

/**
 * usePetwalkerGps
 * Consumer hook for shared GPS infrastructure.
 * This is now a simple wrapper around the global PetwalkerGpsContext.
 */
export const usePetwalkerGps = (_isPetwalker?: boolean) => {
  return usePetwalkerGpsContext();
};

