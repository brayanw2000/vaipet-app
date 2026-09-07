import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.9700b6934ddc48a3b9032d42be56903f',
  appName: 'vaipet',
  webDir: 'dist',
  // Hot-reload direto do sandbox Lovable enquanto desenvolve.
  // Quando for gerar o build de produção pra App Store, comente o bloco
  // `server` para que o app carregue os assets locais empacotados em `dist`.
  server: {
    url: 'https://9700b693-4ddc-48a3-b903-2d42be56903f.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  ios: {
    contentInset: 'always',
    backgroundColor: '#ffffff',
  },
  android: {
    backgroundColor: '#ffffff',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#00A978',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    Geolocation: {
      // Permissão de "Always" pra rastrear o passeio em background.
      permissions: ['location'],
    },
  },
};

export default config;