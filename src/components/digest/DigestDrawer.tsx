import { useEffect } from 'react';
import { X, CheckCheck, Bell } from 'lucide-react';
import type { NotificationItem } from '../../lib/types';

interface DigestDrawerProps {
  open: boolean;
  items: NotificationItem[];
  onClose: () => void;
  onMarkRead: () => void;
  onNavigateHref: (href: string) => void;
}

export function DigestDrawer({ open, items, onClose, onMarkRead, onNavigateHref }: DigestDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Notifications and Daily Digest" className="fixed inset-0 z-50 flex justify-end bg-black/65">
      <div className="flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-[#0E1525] p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-[#22D3EE]" />
            <h2 className="font-display text-xl font-semibold text-white">Notifications &amp; Digest</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications drawer"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-slate-400">Replies, riddle solves, reveals &amp; updates (latest 20)</span>
          {items.some((i) => !i.read_at) && (
            <button
              type="button"
              onClick={onMarkRead}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#22D3EE] hover:underline"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </div>

        <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
          {items.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-[#070B14] p-6 text-center text-sm text-slate-400">
              No notifications yet. Follow thinkers, publish, or solve riddles to receive updates.
            </div>
          ) : (
            items.slice(0, 20).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigateHref(item.href);
                  onClose();
                }}
                className={`block w-full rounded-xl border p-4 text-left transition-colors ${
                  item.read_at
                    ? 'border-slate-800 bg-[#070B14] text-slate-300'
                    : 'border-[#22D3EE]/35 bg-[#131D33] text-slate-100'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="font-mono text-[#A78BFA]">{item.kind.replace(/_/g, ' ')}</span>
                  <span className="tabular-nums">{new Date(item.created_at).toLocaleDateString()}</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-0.5 text-xs text-slate-400 line-clamp-2">{item.body}</p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
