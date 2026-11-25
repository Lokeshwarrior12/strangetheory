import { ShieldAlert } from 'lucide-react';
import type { AppRoute } from '../components/nav/Header';

interface AccessDeniedPageProps {
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
  isSignedIn: boolean;
}

export function AccessDeniedPage({ onNavigate, onOpenAuth, isSignedIn }: AccessDeniedPageProps) {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <ShieldAlert className="mx-auto h-10 w-10 text-rose-400" />
      <p className="mt-4 font-mono text-xs text-rose-400">HTTP 403 · Access Denied</p>
      <h1 className="mt-2 font-display text-3xl sm:text-4xl font-semibold text-white">
        Restricted Observatory Console
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">
        {isSignedIn
          ? 'Your account does not hold Moderator or Admin permissions required for this route.'
          : 'You must sign in with an authorized Moderator or Admin account to view this console.'}
      </p>
      <div className="mt-8 flex justify-center gap-3">
        {!isSignedIn && (
          <button
            type="button"
            onClick={onOpenAuth}
            className="rounded-lg bg-[#22D3EE] px-5 py-2.5 text-sm font-semibold text-slate-950"
          >
            Sign in
          </button>
        )}
        <button
          type="button"
          onClick={() => onNavigate({ name: 'home' })}
          className="rounded-lg border border-slate-700 bg-[#0E1525] px-5 py-2.5 text-sm font-medium text-slate-200"
        >
          Return Home
        </button>
      </div>
    </div>
  );
}
