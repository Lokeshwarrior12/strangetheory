import { useEffect, useState } from 'react';
import { CheckCircle2, MailCheck, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { APP_NAME } from '../lib/config';
import type { AppRoute } from '../components/nav/Header';
import type { Profile } from '../lib/types';

interface AuthPageProps {
  mode: 'signin' | 'signup' | 'reset-password' | 'verify-email';
  token?: string;
  currentUser: Profile | null;
  onSuccess: (user: Profile) => void;
  onNavigate: (route: AppRoute) => void;
}

export function AuthPage({ mode, token, currentUser, onSuccess, onNavigate }: AuthPageProps) {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [tokenInput, setTokenInput] = useState(token || '');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTokenInput(token || '');
    setError(null);
    setInfo(null);
    setPreviewUrl(null);
  }, [mode, token]);

  useEffect(() => {
    if (mode === 'verify-email' && token) {
      setBusy(true);
      api
        .verifyEmail(token)
        .then((res) => {
          setInfo('Your email address is verified.');
          if (res.user) onSuccess(res.user);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Verification failed.'))
        .finally(() => setBusy(false));
    }
  }, [mode, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setPreviewUrl(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const res = await api.login({ emailOrUsername, password });
        onSuccess(res.user);
        onNavigate({ name: 'home' });
      } else if (mode === 'signup') {
        const res = await api.signup({ email, username, display_name: displayName, password });
        onSuccess(res.user);
        setInfo('Account created! Verify your email to unlock full account status.');
        if (res.verification_preview_url) {
          setPreviewUrl(res.verification_preview_url);
        } else {
          onNavigate({ name: 'home' });
        }
      } else if (mode === 'reset-password') {
        if (tokenInput.trim()) {
          const res = await api.confirmResetPassword(tokenInput.trim(), password);
          setInfo(res.message);
        } else {
          const res = await api.resetPassword(email);
          setInfo(res.message);
          if (res.preview_url) setPreviewUrl(res.preview_url);
        }
      } else if (mode === 'verify-email') {
        const res = await api.verifyEmail(tokenInput.trim());
        setInfo('Email address verified!');
        if (res.user) onSuccess(res.user);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.fields?.[0]?.message || err.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-7 shadow-2xl">
        <div className="flex items-center gap-2 font-mono text-xs text-[#22D3EE]">
          <ShieldCheck className="h-4 w-4" />
          {APP_NAME} Authentication
        </div>

        <h1 className="mt-2 font-display text-3xl font-semibold text-white">
          {mode === 'signin'
            ? 'Sign in'
            : mode === 'signup'
              ? 'Create account'
              : mode === 'reset-password'
                ? token
                  ? 'Set new password'
                  : 'Reset password'
                : 'Verify email'}
        </h1>

        <div className="mt-4 flex flex-wrap gap-2 border-b border-slate-800 pb-3 text-xs font-medium">
          <button
            type="button"
            onClick={() => onNavigate({ name: 'auth', mode: 'signin' })}
            className={`rounded-md px-3 py-1.5 ${mode === 'signin' ? 'bg-[#22D3EE] text-slate-950 font-semibold' : 'text-slate-300'}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => onNavigate({ name: 'auth', mode: 'signup' })}
            className={`rounded-md px-3 py-1.5 ${mode === 'signup' ? 'bg-[#22D3EE] text-slate-950 font-semibold' : 'text-slate-300'}`}
          >
            Create account
          </button>
          <button
            type="button"
            onClick={() => onNavigate({ name: 'auth', mode: 'reset-password' })}
            className={`rounded-md px-3 py-1.5 ${mode === 'reset-password' ? 'bg-[#22D3EE] text-slate-950 font-semibold' : 'text-slate-300'}`}
          >
            Reset
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
            {error}
          </div>
        )}
        {info && (
          <div role="status" className="mt-4 rounded-lg border border-emerald-500/35 bg-emerald-950/30 p-3 text-xs text-emerald-100">
            <p className="flex items-center gap-1.5 font-semibold">
              {mode === 'verify-email' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <MailCheck className="h-4 w-4 text-[#22D3EE]" />}
              {info}
            </p>
            {previewUrl && (
              <a href={previewUrl} className="mt-2 inline-block break-all font-mono text-[11px] text-[#22D3EE] underline">
                {previewUrl}
              </a>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
          {mode === 'signin' && (
            <>
              <div>
                <label htmlFor="auth-signin-id" className="block text-xs font-medium text-slate-300 mb-1">Email or Username</label>
                <input
                  id="auth-signin-id"
                  type="text"
                  required
                  value={emailOrUsername}
                  onChange={(e) => setEmailOrUsername(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="auth-signin-pw" className="block text-xs font-medium text-slate-300 mb-1">Password</label>
                <input
                  id="auth-signin-pw"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </>
          )}

          {mode === 'signup' && (
            <>
              <div>
                <label htmlFor="auth-signup-name" className="block text-xs font-medium text-slate-300 mb-1">Display Name</label>
                <input
                  id="auth-signup-name"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="auth-signup-user" className="block text-xs font-medium text-slate-300 mb-1">Username</label>
                <input
                  id="auth-signup-user"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="auth-signup-email" className="block text-xs font-medium text-slate-300 mb-1">Email</label>
                <input
                  id="auth-signup-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="auth-signup-pw" className="block text-xs font-medium text-slate-300 mb-1">Password (min 10 chars)</label>
                <input
                  id="auth-signup-pw"
                  type="password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </>
          )}

          {mode === 'reset-password' && !token && (
            <div>
              <label htmlFor="auth-reset-email" className="block text-xs font-medium text-slate-300 mb-1">Account Email</label>
              <input
                id="auth-reset-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
              />
            </div>
          )}

          {mode === 'reset-password' && token && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Reset Token</label>
                <input
                  type="text"
                  required
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 font-mono text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">New Password (min 10 chars)</label>
                <input
                  type="password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </>
          )}

          {mode === 'verify-email' && !token && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Verification Token</label>
              <input
                type="text"
                required
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[#22D3EE] py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
          >
            {busy
              ? 'Processing...'
              : mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : mode === 'reset-password'
                    ? token
                      ? 'Confirm New Password'
                      : 'Request Reset Link'
                    : 'Verify Email'}
          </button>
        </form>

        {currentUser && mode === 'verify-email' && (
          <button
            type="button"
            onClick={() => onNavigate({ name: 'home' })}
            className="mt-4 w-full rounded-lg border border-slate-700 py-2 text-xs font-semibold text-slate-200"
          >
            Continue to {APP_NAME}
          </button>
        )}
      </div>
    </div>
  );
}
