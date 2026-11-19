import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info';
  message: string;
}

interface ToastContextValue {
  pushToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextValue>({ pushToast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, kind: 'success' | 'error' | 'info' = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-5 right-5 z-[100] flex max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-2xl ${
              t.kind === 'error'
                ? 'border-rose-500/40 bg-[#1A1118] text-rose-100'
                : t.kind === 'success'
                  ? 'border-cyan-400/35 bg-[#0C1829] text-slate-100'
                  : 'border-slate-700/80 bg-[#0E1525] text-slate-100'
            }`}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#22D3EE]" />
            ) : t.kind === 'error' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
            )}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="rounded p-0.5 text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
