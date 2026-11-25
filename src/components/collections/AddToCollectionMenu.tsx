import { useEffect, useRef, useState } from 'react';
import { Check, FolderPlus, Plus } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../ui/ToastContext';
import type { CollectionSummary, Profile } from '../../lib/types';

interface AddToCollectionMenuProps {
  postId: string;
  currentUser: Profile | null;
  onOpenAuth: () => void;
}

export function AddToCollectionMenu({ postId, currentUser, onOpenAuth }: AddToCollectionMenuProps) {
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const loadCollections = async () => {
    setLoading(true);
    try {
      const res = await api.getCollections({ postId });
      setCollections(res.collections);
    } catch {
      // handled cleanly
    } finally {
      setLoading(false);
    }
  };

  const handleToggleOpen = () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    const next = !open;
    setOpen(next);
    if (next) loadCollections();
  };

  const handleToggleItem = async (col: CollectionSummary) => {
    setBusyId(col.id);
    try {
      if (col.contains_post) {
        await api.removeFromCollection(col.id, postId);
        setCollections((prev) =>
          prev.map((c) => (c.id === col.id ? { ...c, contains_post: false, item_count: Math.max(0, c.item_count - 1) } : c))
        );
        pushToast(`Removed from "${col.title}".`, 'info');
      } else {
        await api.addToCollection(col.id, postId);
        setCollections((prev) =>
          prev.map((c) => (c.id === col.id ? { ...c, contains_post: true, item_count: c.item_count + 1 } : c))
        );
        pushToast(`Added to "${col.title}".`, 'success');
      }
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to update collection.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleQuickCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setBusyId('__new');
    try {
      const created = await api.createCollection({ title, is_public: false });
      await api.addToCollection(created.collection.id, postId);
      setNewTitle('');
      await loadCollections();
      pushToast(`Created "${created.collection.title}" and added entry.`, 'success');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to create collection.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleToggleOpen}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0E1525] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-[#22D3EE]"
      >
        <FolderPlus className="h-3.5 w-3.5 text-[#22D3EE]" />
        Collect
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-slate-700 bg-[#0E1525] p-3 shadow-2xl">
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-400 mb-2">Add to collection</p>
          {loading ? (
            <p className="py-3 text-xs text-slate-400">Loading collections...</p>
          ) : (
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {collections.length === 0 ? (
                <p className="py-2 text-xs text-slate-400">No collections yet. Create one below.</p>
              ) : (
                collections.map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    disabled={busyId === col.id}
                    onClick={() => handleToggleItem(col)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                      col.contains_post
                        ? 'border-[#22D3EE]/50 bg-[#22D3EE]/10 text-white'
                        : 'border-slate-800 bg-[#070B14] text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span className="truncate font-medium">{col.title}</span>
                    <span className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400 shrink-0">
                      {col.item_count}
                      {col.contains_post && <Check className="h-3.5 w-3.5 text-[#22D3EE]" />}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {collections.length < 10 && (
            <form onSubmit={handleQuickCreate} className="mt-3 flex items-center gap-1.5 border-t border-slate-800 pt-2.5">
              <input
                type="text"
                maxLength={80}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="New collection title..."
                className="flex-1 rounded-md border border-slate-700 bg-[#070B14] px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500"
              />
              <button
                type="submit"
                disabled={busyId === '__new' || !newTitle.trim()}
                aria-label="Create collection"
                className="rounded-md bg-[#22D3EE] p-1.5 text-slate-950 hover:bg-cyan-300 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
