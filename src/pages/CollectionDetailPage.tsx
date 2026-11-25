import { useEffect, useState } from 'react';
import { ArrowLeft, Copy, Globe, Lock, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { PostCard } from '../components/ui/PostCard';
import { useToast } from '../components/ui/ToastContext';
import type { AppRoute } from '../components/nav/Header';
import type { CollectionDetail, EnrichedPost, Profile } from '../lib/types';

interface CollectionDetailPageProps {
  slug: string;
  currentUser: Profile | null;
  onNavigate: (route: AppRoute) => void;
  onOpenPost: (post: EnrichedPost) => void;
  onBookmark: (postId: string) => void;
}

export function CollectionDetailPage({
  slug,
  currentUser,
  onNavigate,
  onOpenPost,
  onBookmark,
}: CollectionDetailPageProps) {
  const { pushToast } = useToast();
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCollection(slug);
      setCollection(res.collection);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load collection.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [slug]);

  if (loading) {
    return <div className="mx-auto max-w-5xl px-6 py-16 text-sm text-slate-400">Loading collection...</div>;
  }

  if (error || !collection) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">Collection Unavailable</h1>
        <p className="mt-2 text-sm text-slate-400">{error || 'This collection does not exist or is private.'}</p>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'explore' })}
          className="mt-6 rounded-lg bg-[#22D3EE] px-5 py-2.5 text-sm font-semibold text-slate-950"
        >
          Back to Explore
        </button>
      </div>
    );
  }

  const isOwner = currentUser?.id === collection.owner_id;

  const handleCopyShare = async () => {
    const url = `${window.location.origin}/collection/${collection.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      pushToast('Collection link copied to clipboard.', 'success');
    } catch {
      pushToast(url, 'info');
    }
  };

  const handleRemoveItem = async (postId: string) => {
    try {
      await api.removeFromCollection(collection.id, postId);
      setCollection((prev) =>
        prev
          ? {
              ...prev,
              item_count: Math.max(0, prev.item_count - 1),
              items: prev.items.filter((item) => item.id !== postId),
            }
          : prev
      );
      pushToast('Removed entry from collection.', 'info');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to remove entry.', 'error');
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <button
        type="button"
        onClick={() => onNavigate({ name: 'collections' })}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All Collections
      </button>

      <header className="rounded-2xl border border-slate-800 bg-[#0E1525] p-6 sm:p-8 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
            {collection.is_public ? (
              <span className="inline-flex items-center gap-1 text-[#22D3EE]">
                <Globe className="h-3.5 w-3.5" />
                Public Collection
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-slate-400">
                <Lock className="h-3.5 w-3.5" />
                Private Collection
              </span>
            )}
            <span>·</span>
            <span>{collection.item_count} entries</span>
          </div>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-semibold text-white">{collection.title}</h1>
          {collection.note && <p className="mt-2 text-sm leading-relaxed text-slate-300">{collection.note}</p>}
          {collection.owner_username && (
            <p className="mt-3 text-xs text-slate-400">
              Curated by{' '}
              <button
                type="button"
                onClick={() => onNavigate({ name: 'profile', username: collection.owner_username! })}
                className="font-semibold text-slate-200 hover:text-[#22D3EE] hover:underline"
              >
                {collection.owner_display_name || `@${collection.owner_username}`}
              </button>
            </p>
          )}
        </div>

        {collection.is_public && (
          <button
            type="button"
            onClick={handleCopyShare}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#131D33] px-4 py-2 text-xs font-semibold text-slate-100 hover:border-[#22D3EE]"
          >
            <Copy className="h-3.5 w-3.5" />
            Share Collection
          </button>
        )}
      </header>

      {collection.items.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-12 text-center text-sm text-slate-400">
          This collection is empty. Open any thought experiment or riddle and click &ldquo;Collect&rdquo; to add it here.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {collection.items.map((post) => (
            <div key={post.id} className="space-y-2">
              <PostCard
                post={post}
                onOpenPost={onOpenPost}
                onOpenAuthor={(u) => onNavigate({ name: 'profile', username: u })}
                onBookmark={onBookmark}
              />
              {isOwner && (
                <button
                  type="button"
                  onClick={() => handleRemoveItem(post.id)}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-300"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove from collection
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
