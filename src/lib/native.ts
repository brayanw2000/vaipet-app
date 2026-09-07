/**
 * Wrapper unificado pras funções nativas via Capacitor.
 *
 * TODAS as chamadas aqui são SAFE NO BROWSER: se o app está rodando como
 * web (preview Lovable, navegador), elas viram no-op ou caem num fallback.
 * Use sem medo a partir de qualquer componente.
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Geolocation, type Position } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Network } from '@capacitor/network';
import { Device } from '@capacitor/device';
import { BiometricAuth, BiometryError } from '@aparajita/capacitor-biometric-auth';

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const platform = (): 'ios' | 'android' | 'web' =>
  Capacitor.getPlatform() as 'ios' | 'android' | 'web';

// ────────────────────────────────────────────────────────────────────────
// Haptics — vibração tátil leve. Browser: no-op.
// ────────────────────────────────────────────────────────────────────────
export const haptic = {
  light: async () => {
    if (!isNative()) return;
    try { await Haptics.impact({ style: ImpactStyle.Light }); } catch { /* ignore */ }
  },
  medium: async () => {
    if (!isNative()) return;
    try { await Haptics.impact({ style: ImpactStyle.Medium }); } catch { /* ignore */ }
  },
  heavy: async () => {
    if (!isNative()) return;
    try { await Haptics.impact({ style: ImpactStyle.Heavy }); } catch { /* ignore */ }
  },
  success: async () => {
    if (!isNative()) return;
    try { await Haptics.notification({ type: NotificationType.Success }); } catch { /* ignore */ }
  },
  warning: async () => {
    if (!isNative()) return;
    try { await Haptics.notification({ type: NotificationType.Warning }); } catch { /* ignore */ }
  },
  error: async () => {
    if (!isNative()) return;
    try { await Haptics.notification({ type: NotificationType.Error }); } catch { /* ignore */ }
  },
  selection: async () => {
    if (!isNative()) return;
    try { await Haptics.selectionStart(); await Haptics.selectionEnd(); } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────────
// Geolocation — pega posição com alta precisão (passeios).
// No browser cai pro navigator.geolocation normal.
// ────────────────────────────────────────────────────────────────────────
export const location = {
  requestPermissions: async () => {
    if (!isNative()) return { location: 'granted' as const };
    return Geolocation.requestPermissions({ permissions: ['location'] });
  },
  getCurrent: async (): Promise<{ lng: number; lat: number; accuracy: number } | null> => {
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
      });
      return { lng: pos.coords.longitude, lat: pos.coords.latitude, accuracy: pos.coords.accuracy };
    } catch {
      return null;
    }
  },
  /** Assina updates contínuos. Retorna um id para passar em clearWatch. */
  watch: async (cb: (p: { lng: number; lat: number; accuracy: number; ts: number }) => void) => {
    return Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 10000 },
      (pos: Position | null, err) => {
        if (err || !pos) return;
        cb({
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy,
          ts: pos.timestamp,
        });
      },
    );
  },
  clearWatch: async (id: string) => {
    try { await Geolocation.clearWatch({ id }); } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────────
// Camera — câmera ou galeria. Devolve Blob pronto pra upload.
// ────────────────────────────────────────────────────────────────────────
export type PickedPhoto = { blob: Blob; mime: string; webPath: string };

export const camera = {
  /** source: 'camera' (selfie/foto na hora) ou 'library' (galeria). */
  pick: async (source: 'camera' | 'library' = 'camera'): Promise<PickedPhoto | null> => {
    try {
      const photo = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
        promptLabelHeader: 'Foto',
        promptLabelPhoto: 'Galeria',
        promptLabelPicture: 'Câmera',
      });
      if (!photo.webPath) return null;
      const res = await fetch(photo.webPath);
      const blob = await res.blob();
      return { blob, mime: blob.type || `image/${photo.format || 'jpeg'}`, webPath: photo.webPath };
    } catch {
      return null;
    }
  },
};

// ────────────────────────────────────────────────────────────────────────
// Share — Share Sheet nativo (Rede Pet, indicar amigos).
// No browser cai pro navigator.share.
// ────────────────────────────────────────────────────────────────────────
export const share = async (opts: { title?: string; text?: string; url?: string; dialogTitle?: string }) => {
  try {
    await Share.share({
      title: opts.title,
      text: opts.text,
      url: opts.url,
      dialogTitle: opts.dialogTitle ?? 'Compartilhar',
    });
    return true;
  } catch {
    return false;
  }
};

// ────────────────────────────────────────────────────────────────────────
// Biometrics — Face ID / Touch ID.
// ────────────────────────────────────────────────────────────────────────
export const biometric = {
  isAvailable: async (): Promise<boolean> => {
    if (!isNative()) return false;
    try {
      const info = await BiometricAuth.checkBiometry();
      return info.isAvailable;
    } catch {
      return false;
    }
  },
  /** Pede autenticação biométrica. Retorna true se OK. */
  authenticate: async (reason = 'Autentique-se para continuar'): Promise<boolean> => {
    if (!isNative()) return true; // browser: assume OK pra não bloquear dev
    try {
      await BiometricAuth.authenticate({
        reason,
        cancelTitle: 'Cancelar',
        allowDeviceCredential: true,
        iosFallbackTitle: 'Usar código',
        androidTitle: 'VaiPet',
        androidSubtitle: reason,
        androidConfirmationRequired: false,
      });
      return true;
    } catch (e) {
      if (e instanceof BiometryError) {
        console.warn('Biometric failed:', e.code, e.message);
      }
      return false;
    }
  },
};

// ────────────────────────────────────────────────────────────────────────
// Status Bar + Splash Screen — chrome do app.
// ────────────────────────────────────────────────────────────────────────
export const ui = {
  setStatusBarStyle: async (mode: 'light' | 'dark') => {
    if (!isNative()) return;
    try {
      await StatusBar.setStyle({ style: mode === 'dark' ? Style.Dark : Style.Light });
    } catch { /* ignore */ }
  },
  hideSplash: async () => {
    if (!isNative()) return;
    try { await SplashScreen.hide(); } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────────
// Preferences — KV storage nativo (criptografado no iOS via Keychain).
// ────────────────────────────────────────────────────────────────────────
export const prefs = {
  get: async <T = string>(key: string): Promise<T | null> => {
    try {
      const r = await Preferences.get({ key });
      if (r.value == null) return null;
      try { return JSON.parse(r.value) as T; } catch { return r.value as unknown as T; }
    } catch { return null; }
  },
  set: async (key: string, value: unknown) => {
    try {
      const v = typeof value === 'string' ? value : JSON.stringify(value);
      await Preferences.set({ key, value: v });
    } catch { /* ignore */ }
  },
  remove: async (key: string) => {
    try { await Preferences.remove({ key }); } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────────
// App lifecycle / back button / deep links.
// ────────────────────────────────────────────────────────────────────────
export const app = {
  onBackButton: (cb: () => void) => {
    if (!isNative()) return () => { /* noop */ };
    const h = App.addListener('backButton', cb);
    return () => { h.then(l => l.remove()); };
  },
  onAppStateChange: (cb: (active: boolean) => void) => {
    const h = App.addListener('appStateChange', ({ isActive }) => cb(isActive));
    return () => { h.then(l => l.remove()); };
  },
  onDeepLink: (cb: (url: string) => void) => {
    const h = App.addListener('appUrlOpen', (e) => cb(e.url));
    return () => { h.then(l => l.remove()); };
  },
};

// ────────────────────────────────────────────────────────────────────────
// In-app browser (links externos sem sair do app).
// ────────────────────────────────────────────────────────────────────────
export const openExternal = async (url: string) => {
  try {
    await Browser.open({ url, presentationStyle: 'popover' });
  } catch {
    window.open(url, '_blank');
  }
};

// ────────────────────────────────────────────────────────────────────────
// Network + Device info — útil pra telemetria, offline UI etc.
// ────────────────────────────────────────────────────────────────────────
export const network = {
  status: () => Network.getStatus(),
  onChange: (cb: (online: boolean) => void) => {
    const h = Network.addListener('networkStatusChange', (s) => cb(s.connected));
    return () => { h.then(l => l.remove()); };
  },
};

export const device = {
  info: () => Device.getInfo(),
  id: () => Device.getId(),
};