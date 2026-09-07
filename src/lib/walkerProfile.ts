export type TransportMode = 'foot' | 'bike' | 'moto' | 'car';

// Single, real, persistent petwalker used across the entire app while we
// are in beta. Replaces the previous pool of fictitious walkers with random
// avatars and names. Keep `name` and `avatar` in sync with anything stored
// in the database (walk_sessions.walker_name) so resuming a walk shows the
// same person.
export const BETA_WALKER_NAME = 'PetWalker Beta';
export const BETA_WALKER_AVATAR =
  'https://pczxvsvsieijmtuzsdfy.supabase.co/storage/v1/object/public/pet-photos/walkers/petwalker-beta-v2.webp';

export interface TransportInfo {
  mode: TransportMode;
  label: string;
  emoji: string;
  speedKmh: number; // average travel speed used for pickup ETA & animation
}

export const TRANSPORTS: Record<TransportMode, TransportInfo> = {
  foot: { mode: 'foot', label: 'A pé', emoji: '🚶', speedKmh: 5 },
  bike: { mode: 'bike', label: 'De bike', emoji: '🚴', speedKmh: 18 },
  moto: { mode: 'moto', label: 'De moto', emoji: '🏍️', speedKmh: 45 },
  car:  { mode: 'car',  label: 'De carro', emoji: '🚗', speedKmh: 35 },
};

export const pickTransportForDistance = (distanceKm: number): TransportInfo => {
  // Foot only when extremely close (<200m). Otherwise prefer bike/moto/car.
  if (distanceKm < 0.2) return TRANSPORTS.foot;
  if (distanceKm < 1.2) {
    const r = Math.random();
    if (r < 0.55) return TRANSPORTS.bike;
    if (r < 0.85) return TRANSPORTS.moto;
    return TRANSPORTS.car;
  }
  if (distanceKm < 4) {
    const r = Math.random();
    if (r < 0.5) return TRANSPORTS.moto;
    if (r < 0.9) return TRANSPORTS.car;
    return TRANSPORTS.bike;
  }
  return Math.random() < 0.6 ? TRANSPORTS.car : TRANSPORTS.moto;
};

export interface WalkerProfile {
  name: string;
  firstName: string;
  avatar: string;
  rating: number;
  walks: number;
  code: string; // 4-digit pickup confirmation code
  avatar_url?: string; // Unified with DB schema
  completed_walks?: number; // Unified with DB schema
}

// Always returns the single PetWalker Beta profile. A fresh 4-digit pickup
// code is generated per walk so the "confirme o código" handoff still works.
export const generateRandomWalker = (): WalkerProfile => ({
  name: BETA_WALKER_NAME,
  firstName: 'PetWalker',
  avatar: BETA_WALKER_AVATAR,
  rating: 5.0,
  walks: 128,
  code: Math.floor(1000 + Math.random() * 9000).toString(),
});

// Build a walker profile for a previously saved walk (resume). Reuses the
// canonical beta identity and the code stored on the session (when present),
// falling back to a fresh code if the DB row predates code persistence.
export const buildBetaWalker = (code?: string | null): WalkerProfile => ({
  name: BETA_WALKER_NAME,
  firstName: 'PetWalker',
  avatar: BETA_WALKER_AVATAR,
  rating: 5.0,
  walks: 128,
  code: (code && /^\d{4}$/.test(code)) ? code : Math.floor(1000 + Math.random() * 9000).toString(),
});