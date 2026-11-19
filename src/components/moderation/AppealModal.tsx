import { useEffect, useState } from 'react';
import { X, Scale } from 'lucide-react';
import { api, ApiError } from '../../lib/api';

interface AppealModalProps {
  target: { type: 'post' | 'comment' | 'user'; id: string; label: string } | null;
  onClose: () => void;
  onSubmitted?: () => void;
}

export function AppealModal({ target, onClose, onSubmitted }: AppealModalProps) {
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [target, onClose]);

  if (!target) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.submitAppeal({ target_type: target.type, target_id: target.id, reason });
      setSent(true);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit appeal.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Appeal moderation decision" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-[#0E1525] p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close appeal dialog"
          className="absolute top-4 right-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 text-[#A78BFA]">
          <Scale className="h-4 w-4" />
          <h2 className="font-display text-xl font-semibold text-white">Submit Appeal</h2>
        </div>
        <p className="mt-1 text-xs text-slate-400 truncate">{target.label}</p>

        {sent ? (
          <div className="mt-5 space-y-4">
            <p className="rounded-lg border border-cyan-500/35 bg-cyan-950/35 p-3 text-sm text-cyan-100">
              Your appeal has been logged for moderator review.
            </p>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setReason('');
                onClose();
              }}
              className="w-full rounded-lg bg-[#22D3EE] py-2 text-sm font-semibold text-slate-950"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            {error && <p className="rounded-lg border border-rose-500/40 bg-rose-950/50 p-2.5 text-xs text-rose-200">{error}</p>}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Explain why this decision should be reconsidered
              </label>
              <textarea
                required
                minLength={10}
                maxLength={800}
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Provide context or clarifications for the moderation team..."
                className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-[#A78BFA] py-2.5 text-sm font-semibold text-slate-950 hover:bg-violet-300 disabled:opacity-50"
            >
              {busy ? 'Sending...' : 'Send Appeal'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
