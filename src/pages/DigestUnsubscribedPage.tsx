import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { AppRoute } from '../components/nav/Header';

interface DigestUnsubscribedPageProps {
  status?: string;
  onNavigate: (route: AppRoute) => void;
}

export function DigestUnsubscribedPage({ status = 'ok', onNavigate }: DigestUnsubscribedPageProps) {
  const valid = status !== 'invalid';

  return (
    <div className="mx-auto max-w-lg px-6 py-20">
      <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-8 text-center">
        {valid ? (
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
        ) : (
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
        )}
        <h1 className="mt-4 font-display text-2xl font-semibold text-white">
          {valid ? 'Unsubscribed from The Weekly Synapse' : 'Invalid Unsubscribe Link'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          {valid
            ? 'You will no longer receive weekly digest emails. You can opt back in anytime from your Settings page.'
            : 'This unsubscribe token appears invalid or expired. Manage your digest preference directly in Settings.'}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate({ name: 'home' })}
            className="rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
          >
            Back to Observatory
          </button>
          <button
            type="button"
            onClick={() => onNavigate({ name: 'settings' })}
            className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500"
          >
            Open Settings
          </button>
        </div>
      </div>
    </div>
  );
}
