import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface MotionContextValue {
  reducedMotion: boolean;
  setReducedMotion: (next: boolean) => void;
  toggleReducedMotion: () => void;
}

const MotionContext = createContext<MotionContextValue | null>(null);

const STORAGE_KEY = 'st_reduced_motion';

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reducedMotion, setReducedMotionState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === '1') return true;
    if (saved === '0') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => {
      if (window.localStorage.getItem(STORAGE_KEY) === null) {
        setReducedMotionState(e.matches);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setReducedMotion = (next: boolean) => {
    setReducedMotionState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  };

  const toggleReducedMotion = () => setReducedMotion(!reducedMotion);

  return (
    <MotionContext.Provider value={{ reducedMotion, setReducedMotion, toggleReducedMotion }}>
      {children}
    </MotionContext.Provider>
  );
}

export function useMotionPreference(): MotionContextValue {
  const ctx = useContext(MotionContext);
  if (!ctx) {
    return {
      reducedMotion: false,
      setReducedMotion: () => {},
      toggleReducedMotion: () => {},
    };
  }
  return ctx;
}
