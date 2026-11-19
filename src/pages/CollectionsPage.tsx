import { useEffect, useState } from 'react';
import { Copy, Edit3, FolderHeart, Globe, Lock, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { FOCUS_LIMITS } from '../lib/config';
import { useToast } from '../components/ui/ToastContext';
import type { AppRoute } from '../components/nav/Header';
import type { CollectionSummary, Profile } from '../lib/types';

interface CollectionsPageProps {
  currentUser: Profile | null;
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
}

export function CollectionsPage({ currentUser, onNavigate, onOpenAuth }: CollectionsPageProps) {
  const { pushToast } = useToast();
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editPublic, setEditPublic] = useState(true);

  const load = async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.getCollections();
      setCollections(res.collections);
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to load collections.', 'error');
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
        <FolderHeart className="mx-auto h-10 w-10 text-[#22D3EE]" />
        <h1 className="mt-4 font-display text-3xl font-semibold text-white">Curated Collections</h1>
        <p className="mt-2 text-sm text-slate-400">
          Sign in to organize up to 10 reading lists of thought experiments and riddles, private or public.
        </p>
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const res = await api.createCollection({ title: title.trim(), note: note.trim(), is_public: isPublic });
      setCollections((prev) => [res.collection, ...prev]);
      setTitle('');
      setNote('');
      pushToast('Collection created.', 'success');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to create collection.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    setBusy(true);
    try {
      const res = await api.updateCollection(id, { title: editTitle.trim(), note: editNote.trim(), is_public: editPublic });
      setCollections((prev) => prev.map((c) => (c.id === id ? res.collection : c)));
      setEditingId(null);
      pushToast('Collection updated.', 'success');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Update failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await api.deleteCollection(id);
      setCollections((prev) => prev.filter((c) => c.id !== id));
      pushToast('Collection deleted.', 'info');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Delete failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyShare = async (slug: string) => {
    const url = `${window.location.origin}/collection/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      pushToast('Public collection link copied.', 'success');
    } catch {
      pushToast(url, 'info');
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <p className="font-mono text-xs text-[#22D3EE]">
            Curated Lists · {collections.length} / {FOCUS_LIMITS.MAX_COLLECTIONS_PER_USER}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-white">Collections</h1>
          <p className="mt-1 text-sm text-slate-400">
            Group up to {FOCUS_LIMITS.MAX_ITEMS_PER_COLLECTION} entries per collection with an editorial note.
          </p>
        </div>
      </div>

      {/* Create Form */}
      {collections.length < FOCUS_LIMITS.MAX_COLLECTIONS_PER_USER && (
        <form onSubmit={handleCreate} className="rounded-2xl border border-slate-800 bg-[#0E1525] p-6 space-y-4">
          <h2 className="font-display text-lg font-semibold text-white">New Collection</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Collection title (e.g., Paradoxes of Time)"
              className="rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
            />
            <input
              type="text"
              maxLength={280}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional curator note..."
              className="rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              <span>Public collection (visible on your profile &amp; shareable by link)</span>
            </label>
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              Create Collection
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading your collections...</p>
      ) : collections.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-10 text-center text-sm text-slate-400">
          No collections created yet. Create one above or use the &ldquo;Collect&rdquo; button on any entry.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {collections.map((col) => (
            <div key={col.id} className="rounded-2xl border border-slate-800 bg-[#0E1525] p-5 flex flex-col justify-between">
              {editingId === col.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-white"
                  />
                  <textarea
                    rows={2}
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-xs text-slate-200"
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={editPublic} onChange={(e) => setEditPublic(e.target.checked)} />
                    Public collection
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleSaveEdit(col.id)}
                      className="rounded-lg bg-[#22D3EE] px-3 py-1.5 text-xs font-semibold text-slate-950"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 font-mono text-slate-400">
                        {col.is_public ? <Globe className="h-3.5 w-3.5 text-[#22D3EE]" /> : <Lock className="h-3.5 w-3.5 text-slate-500" />}
                        {col.is_public ? 'Public' : 'Private'}
                      </span>
                      <span className="font-mono text-slate-400 tabular-nums">
                        {col.item_count} / {FOCUS_LIMITS.MAX_ITEMS_PER_COLLECTION} entries
                      </span>
                    </div>
                    <h3 className="mt-2 font-display text-xl font-semibold text-white">
                      <button
                        type="button"
                        onClick={() => onNavigate({ name: 'collection-detail', slug: col.slug })}
                        className="text-left hover:text-[#22D3EE] transition-colors"
                      >
                        {col.title}
                      </button>
                    </h3>
                    {col.note && <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{col.note}</p>}
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3 text-xs">
                    <button
                      type="button"
                      onClick={() => onNavigate({ name: 'collection-detail', slug: col.slug })}
                      className="font-semibold text-[#22D3EE] hover:underline"
                    >
                      Open Collection →
                    </button>
                    <div className="flex items-center gap-2">
                      {col.is_public && (
                        <button
                          type="button"
                          onClick={() => handleCopyShare(col.slug)}
                          aria-label={`Copy share link for ${col.title}`}
                          className="rounded-md border border-slate-700 p-1.5 text-slate-300 hover:border-[#22D3EE] hover:text-white"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(col.id);
                          setEditTitle(col.title);
                          setEditNote(col.note);
                          setEditPublic(col.is_public);
                        }}
                        aria-label={`Edit ${col.title}`}
                        className="rounded-md border border-slate-700 p-1.5 text-slate-300 hover:border-[#22D3EE] hover:text-white"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDelete(col.id)}
                        aria-label={`Delete ${col.title}`}
                        className="rounded-md border border-rose-500/35 p-1.5 text-rose-300 hover:bg-rose-950/50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
