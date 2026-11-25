import { useEffect, useState } from 'react';
import { X, MailCheck } from 'lucide-react';
import { api, ApiError, type DemoAccount } from '../../lib/api';
import { APP_NAME } from '../../lib/config';
import type { Profile } from '../../lib/types';

interface AuthModalProps {
  open: boolean;
  demoAccounts: DemoAccount[];
  googleEnabled?: boolean;
  initialMode?: 'signin' | 'signup' | 'reset';
  onClose: () => void;
  onSuccess: (user: Profile) => void;
}

export function AuthModal({
  open,
  demoAccounts,
  googleEnabled = false,
  initialMode = 'signin',
  onClose,
  onSuccess,
}: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>(initialMode);
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [previewLink, setPreviewLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setPreviewLink(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const res = await api.login({ emailOrUsername, password });
        onSuccess(res.user);
        onClose();
      } else if (mode === 'signup') {
        const res = await api.signup({ email, username, display_name: displayName, password });
        onSuccess(res.user);
        if (res.verification_preview_url) {
          setInfo('Account created! Verify your email using the confirmation link below:');
          setPreviewLink(res.verification_preview_url);
        } else {
          onClose();
        }
      } else {
        const res = await api.resetPassword(email);
        setInfo(res.message);
        if (res.preview_url) setPreviewLink(res.preview_url);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.fields?.[0]?.message || err.message);
      } else {
        setError('Unable to reach the server. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDemoSwitch = async (userId: string) => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.demoSwitch(userId);
      onSuccess(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to switch demo account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-[#0E1525] p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sign in dialog"
          className="absolute top-4 right-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 id="auth-modal-title" className="font-display text-2xl font-semibold text-white">
          {mode === 'signin'
            ? `Sign in to ${APP_NAME}`
            : mode === 'signup'
              ? `Join ${APP_NAME}`
              : 'Reset password'}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {mode === 'signin'
            ? 'Publish thought experiments, solve riddles, and earn Synapse.'
            : mode === 'signup'
              ? 'Create your member profile with verifiable email security.'
              : 'Request a time-limited password reset token.'}
        </p>

        <div className="mt-4 flex gap-2 border-b border-slate-800 pb-3 text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setMode('signin');
              setError(null);
              setInfo(null);
            }}
            className={`rounded-md px-3 py-1.5 ${
              mode === 'signin' ? 'bg-[#22D3EE] text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setError(null);
              setInfo(null);
            }}
            className={`rounded-md px-3 py-1.5 ${
              mode === 'signup' ? 'bg-[#22D3EE] text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Create account
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('reset');
              setError(null);
              setInfo(null);
            }}
            className={`rounded-md px-3 py-1.5 ${
              mode === 'reset' ? 'bg-[#22D3EE] text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Reset password
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}
        {info && (
          <div role="status" className="mt-4 rounded-lg border border-cyan-500/35 bg-cyan-950/35 px-3 py-2.5 text-xs text-cyan-100">
            <p className="flex items-center gap-1.5 font-medium">
              <MailCheck className="h-4 w-4 shrink-0 text-[#22D3EE]" />
              {info}
            </p>
            {previewLink && (
              <a
                href={previewLink}
                className="mt-2 inline-block break-all font-mono text-[11px] text-[#22D3EE] underline"
              >
                {previewLink}
              </a>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {mode === 'signin' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email or Username</label>
                <input
                  type="text"
                  required
                  value={emailOrUsername}
                  onChange={(e) => setEmailOrUsername(e.target.value)}
                  placeholder="aria_chen or aria@strangetheory.app"
                  className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
                />
              </div>
            </>
          )}

          {mode === 'signup' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Dr. Maya Lin"
                  className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Username</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="maya_lin"
                    className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="maya@example.com"
                    className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Password (min 10 chars)</label>
                <input
                  type="password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
                />
              </div>
            </>
          )}

          {mode === 'reset' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Account Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[#22D3EE] py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
          >
            {busy
              ? 'Working...'
              : mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Send reset instructions'}
          </button>
        </form>

        {googleEnabled && (
          <div className="mt-3 text-center">
            <p className="text-xs text-slate-400">
              Google Sign-In is enabled on this instance.
            </p>
          </div>
        )}

        {/* Dev-only member demo switcher (never shown in production, never exposes Moderator/Admin) */}
        {demoAccounts.length > 0 && (
          <div className="mt-6 border-t border-slate-800 pt-4">
            <p className="text-xs font-medium text-slate-400 mb-2">
              Local development member preview (disabled in production)
            </p>
            <div className="grid grid-cols-2 gap-2">
              {demoAccounts.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  disabled={busy}
                  onClick={() => handleDemoSwitch(acc.id)}
                  className="flex flex-col items-start rounded-lg border border-slate-800 bg-[#070B14] px-3 py-2 text-left hover:border-[#22D3EE]/60 transition-colors"
                >
                  <span className="text-xs font-semibold text-slate-100">{acc.display_name}</span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {acc.role} · {acc.synapse_total} Syn
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
