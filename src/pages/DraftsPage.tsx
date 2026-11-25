import { useEffect, useState } from 'react';
import { Edit3, Send, Trash2, Plus } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useToast } from '../components/ui/ToastContext';
import type { AppRoute } from '../components/nav/Header';
import type { EnrichedPost, Profile } from '../lib/types';

interface DraftsPageProps {
  currentUser: Profile | null;
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
}

export function DraftsPage({ currentUser, onNavigate, onOpenAuth }: DraftsPageProps) {
  const { pushToast } = useToast();
  const [drafts, setDrafts] = useState<EnrichedPost[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDrafts = async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.getProfile(currentUser.username);
      setDrafts(res.drafts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDrafts();
  }, [currentUser?.id]);

  if (!currentUser) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">My Drafts</h1>
        <p className="mt-3 text-sm text-slate-400">Sign in to view and manage your unpublished drafts.</p>
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

  const handlePublish = async (post: EnrichedPost) => {
    try {
      const res = await api.publishPost(post.id);
      pushToast('Draft published!', 'success');
      onNavigate(res.post.type === 'riddle' ? { name: 'riddle', slug: res.post.slug } : { name: 'post', slug: res.post.slug });
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to publish draft.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deletePost(id);
      pushToast('Draft deleted.', 'info');
      loadDrafts();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Delete failed.', 'error');
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold text-white">My Drafts</h1>
          <p className="mt-1 text-sm text-slate-400">Autosaved works in progress private to your account.</p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'write' })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
        >
          <Plus className="h-3.5 w-3.5" />
          New Entry
        </button>
      </div>

      <div className="mt-8 space-y-4">
        {loading ? (
          <p className="text-sm text-slate-400">Loading drafts...</p>
        ) : drafts.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-10 text-center text-sm text-slate-400">
            You have no saved drafts right now.
          </div>
        ) : (
          drafts.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#0E1525] p-5">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-[#A78BFA]">
                  {d.type === 'riddle' ? 'Riddle Draft' : 'Experiment Draft'} · Updated {new Date(d.updated_at).toLocaleString()}
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold text-white truncate">{d.title}</h2>
                <p className="mt-1 text-sm text-slate-400 line-clamp-2">{d.intro}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'write', editId: d.id })}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#131D33] px-3 py-1.5 text-xs font-semibold text-slate-100 hover:border-[#22D3EE]"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handlePublish(d)}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#22D3EE] px-3 py-1.5 text-xs font-semibold text-slate-950"
                >
                  <Send className="h-3.5 w-3.5" />
                  Publish
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(d.id)}
                  className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-1.5 text-rose-300 hover:bg-rose-950/60"
                  aria-label={`Delete ${d.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
