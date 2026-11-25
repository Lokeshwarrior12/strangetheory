import { useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { APP_NAME } from '../../lib/config';

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          compact
            ? 'inline-flex items-center gap-1.5 rounded-lg border border-[#22D3EE]/40 bg-[#22D3EE]/10 px-2.5 py-1.5 text-xs font-semibold text-[#22D3EE] hover:bg-[#22D3EE]/20 whitespace-nowrap'
            : 'inline-flex items-center gap-2 rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 transition-colors whitespace-nowrap'
        }
      >
        <Download className="h-3.5 w-3.5" />
        Install App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0E1525] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-[#22D3EE] whitespace-nowrap"
        >
          <Smartphone className="h-3.5 w-3.5 text-[#22D3EE]" />
          Install on iOS
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Install ${APP_NAME} on iOS`}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          >
            <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-[#0E1525] p-6 shadow-2xl">
              <h3 className="font-display text-lg font-semibold text-white">Install on iPhone / iPad</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                1. Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
                <br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-[#22D3EE] py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
