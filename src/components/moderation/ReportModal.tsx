import { useEffect, useState } from 'react';
import { X, Flag } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { REPORT_REASONS } from '../../lib/config';

interface ReportModalProps {
  target: { type: 'post' | 'comment'; id: string; label: string } | null;
  onClose: () => void;
}

export function ReportModal({ target, onClose }: ReportModalProps) {
  const [selected, setSelected] = useState<string>(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<string | null>(null);
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
      const reason = details.trim() ? `${selected}: ${details.trim()}` : selected;
      await api.submitReport({ target_type: target.type, target_id: target.id, reason });
      setStatus('Report received. Thank you for keeping StrangeTheory thoughtful and respectful.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit report. Please sign in first.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Report content" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-[#0E1525] p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close report dialog"
          className="absolute top-4 right-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 text-rose-400">
          <Flag className="h-4 w-4" />
          <h2 className="font-display text-xl font-semibold text-white">Report {target.type}</h2>
        </div>
        <p className="mt-1 text-xs text-slate-400 truncate">{target.label}</p>

        {status ? (
          <div className="mt-5 space-y-4">
            <p className="rounded-lg border border-emerald-500/35 bg-emerald-950/35 p-3 text-sm text-emerald-200">{status}</p>
            <button
              type="button"
              onClick={() => {
                setStatus(null);
                setDetails('');
                onClose();
              }}
              className="w-full rounded-lg bg-[#22D3EE] py-2 text-sm font-semibold text-slate-950"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            {error && <p className="rounded-lg bg-rose-950/50 border border-rose-500/40 p-2.5 text-xs text-rose-200">{error}</p>}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Reason</label>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
              >
                {REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Additional context (optional)</label>
              <textarea
                rows={3}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={350}
                placeholder="Briefly describe the issue..."
                className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-rose-600 py-2.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              {busy ? 'Submitting...' : 'Submit Report'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
