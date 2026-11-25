import { useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/ToastContext';
import type { NotificationItem, Profile } from '../lib/types';

interface NotificationsPageProps {
  currentUser: Profile | null;
  onOpenAuth: () => void;
  onNavigatePath: (href: string) => void;
  onUserRefresh: () => void;
}

export function NotificationsPage({
  currentUser,
  onOpenAuth,
  onNavigatePath,
  onUserRefresh,
}: NotificationsPageProps) {
  const { pushToast } = useToast();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.getNotifications();
      setItems(res.items);
      setDigestEnabled(res.daily_digest_enabled);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [currentUser?.id]);

  if (!currentUser) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">Notifications</h1>
        <p className="mt-3 text-sm text-slate-400">Sign in to view replies, solved awards, and digest updates.</p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="mt-6 rounded-lg bg-[#22D3EE] px-5 py-2.5 text-sm font-semibold text-slate-950"
        >
          Sign in
        </button>
      </div>
    );
  }

  const toggleDigest = async () => {
    const next = !digestEnabled;
    await api.updateProfile({ daily_digest_enabled: next });
    setDigestEnabled(next);
    onUserRefresh();
    pushToast(next ? 'Daily digest notifications enabled.' : 'Daily digest notifications paused.', 'info');
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center gap-2.5">
          <Bell className="h-5 w-5 text-[#22D3EE]" />
          <h1 className="font-display text-3xl font-semibold text-white">Notifications</h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleDigest}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              digestEnabled
                ? 'border-[#22D3EE]/50 bg-[#22D3EE]/15 text-[#22D3EE]'
                : 'border-slate-700 bg-[#0E1525] text-slate-400'
            }`}
          >
            Daily Digest: {digestEnabled ? 'On' : 'Off'}
          </button>
          {items.some((i) => !i.read_at) && (
            <button
              type="button"
              onClick={async () => {
                await api.markNotificationsRead();
                await load();
                onUserRefresh();
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0E1525] px-3 py-1.5 text-xs font-semibold text-slate-200"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-sm text-slate-400">Loading notifications...</p>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-10 text-center text-sm text-slate-400">
            All caught up. Replies, riddle acceptances, and followed author alerts will appear here.
          </div>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigatePath(item.href)}
              className={`block w-full rounded-xl border p-4 text-left transition-colors ${
                item.read_at
                  ? 'border-slate-800 bg-[#0E1525] text-slate-300'
                  : 'border-[#22D3EE]/40 bg-[#131D33] text-white'
              }`}
            >
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-mono text-[#A78BFA]">{item.kind.replace('_', ' ')}</span>
                <span className="tabular-nums">{new Date(item.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-sm font-semibold">{item.title}</p>
              <p className="mt-0.5 text-xs text-slate-400">{item.body}</p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
