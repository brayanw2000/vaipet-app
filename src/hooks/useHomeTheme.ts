import { useEffect, useState } from 'react';

export type HomeTheme = 'light' | 'dark';

const STORAGE_KEY = 'vp_home_theme';
const EVENT = 'vp:home-theme-change';

export const LIGHT = { paper: '#F7F5EF', ink: '#0B1410' };
export const DARK = { paper: '#0B1410', ink: '#F7F5EF' };

const read = (): HomeTheme => {
  if (typeof window === 'undefined') return 'light';
  return (localStorage.getItem(STORAGE_KEY) as HomeTheme) || 'light';
};

export function useHomeTheme() {
  const [theme, setThemeState] = useState<HomeTheme>(read);

  useEffect(() => {
    const sync = () => setThemeState(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setTheme = (t: HomeTheme) => {
    localStorage.setItem(STORAGE_KEY, t);
    window.dispatchEvent(new Event(EVENT));
    setThemeState(t);
  };
  const toggle = () => setTheme(theme === 'light' ? 'dark' : 'light');

  const palette = theme === 'light' ? LIGHT : DARK;
  // Inverted palette for elements that should contrast against the page.
  const inverted = theme === 'light' ? DARK : LIGHT;

  return { theme, setTheme, toggle, palette, inverted };
}
