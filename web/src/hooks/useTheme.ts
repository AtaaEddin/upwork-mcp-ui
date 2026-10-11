import { useCallback, useEffect, useRef, useState } from 'react';

export type Theme = 'light' | 'dark';

/** Must stay in sync with the pre-paint inline script in web/index.html. */
export const THEME_STORAGE_KEY = 'upwork-theme';

/**
 * Optional `?theme=light|dark` URL override (first value wins). Lets users —
 * and the browser-verification screenshots — force a theme per URL.
 */
export function urlThemeOverride(): Theme | null {
  const value = new URLSearchParams(window.location.search).get('theme');
  return value === 'light' || value === 'dark' ? value : null;
}

function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function initialTheme(): Theme {
  const override = urlThemeOverride();
  if (override !== null) return override;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // storage unavailable (e.g. private mode)
  }
  return systemPrefersDark() ? 'dark' : 'light';
}

/**
 * Class-based dark theme (Tailwind 4 `dark` variant): toggles `.dark` on
 * `<html>` and persists explicit choices in localStorage. Until the user
 * toggles, the system preference (`prefers-color-scheme`) is followed.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const chosen = useRef(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggle = useCallback((): void => {
    chosen.current = true;
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // storage unavailable — theme still applies for this page load
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
