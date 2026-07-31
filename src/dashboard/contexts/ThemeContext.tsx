import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type AdminTheme = 'light' | 'dark';

const STORAGE_KEY = 'jlo-admin-theme';

type ThemeContextValue = {
  theme: AdminTheme;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (theme: AdminTheme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): AdminTheme {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AdminTheme>(() => readStoredTheme());

  const setTheme = useCallback((next: AdminTheme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [setTheme, theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
    root.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      isDark: theme === 'dark',
      toggleTheme,
      setTheme,
    }),
    [theme, toggleTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
