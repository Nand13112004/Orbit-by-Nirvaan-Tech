'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';

type ThemeContextValue = { isDark: boolean; toggleTheme: () => void };
const ThemeContext = createContext<ThemeContextValue>({ isDark: false, toggleTheme: () => undefined });

function subscribeToTheme(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener('orbit-theme-change', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('orbit-theme-change', onChange);
  };
}

function getThemeSnapshot() {
  return window.localStorage.getItem('orbit-theme') === 'dark';
}

function getServerThemeSnapshot() {
  return false;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  const isDark = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    const mark = isDark ? '/orbit-mark.png' : '/black-orbit-mark.png';
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach((icon) => {
      icon.href = mark;
    });
  }, [isDark]);
  const toggleTheme = () => {
    const next = !isDark;
    window.localStorage.setItem('orbit-theme', next ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', next);
    window.dispatchEvent(new Event('orbit-theme-change'));
  };

  return <ThemeContext.Provider value={{ isDark, toggleTheme }}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></ThemeContext.Provider>;
}
