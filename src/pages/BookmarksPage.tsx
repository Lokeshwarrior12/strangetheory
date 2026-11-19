import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PostCard } from '../components/ui/PostCard';
import type { AppRoute } from '../components/nav/Header';
import type { EnrichedPost, Profile } from '../lib/types';

interface BookmarksPageProps {
  currentUser: Profile | null;
  onNavigate: (route: AppRoute) => void;
  onOpenPost: (post: EnrichedPost) => void;
  onOpenAuth: () => void;
}

export function BookmarksPage({ currentUser, onNavigate, onOpenPost, onOpenAuth }: BookmarksPageProps) {
  const [bookmarks, setBookmarks] = useState<EnrichedPost[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.getProfile(currentUser.username);
      setBookmarks(res.bookmarks);
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
        <h1 className="font-display text-3xl font-semibold text-white">Bookmarks</h1>
        <p className="mt-3 text-sm text-slate-400">Sign in to view your saved thought experiments and riddles.</p>
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="border-b border-slate-800 pb-6">
        <h1 className="font-display text-3xl font-semibold text-white">Saved Bookmarks</h1>
        <p className="mt-1 text-sm text-slate-400">Your private shelf of theories and puzzles to revisit.</p>
      </div>

      <div className="mt-8">
        {loading ? (
          <p className="text-sm text-slate-400">Loading bookmarks...</p>
        ) : bookmarks.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-12 text-center">
            <p className="font-display text-xl font-semibold text-white">No bookmarks yet</p>
            <p className="mt-2 text-sm text-slate-400">Tap Save on any experiment or riddle to store it here.</p>
            <button
              type="button"
              onClick={() => onNavigate({ name: 'explore' })}
              className="mt-5 rounded-lg bg-[#22D3EE] px-5 py-2.5 text-xs font-semibold text-slate-950"
            >
              Browse Observatory
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {bookmarks.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onOpenPost={onOpenPost}
                onOpenAuthor={(username) => onNavigate({ name: 'profile', username })}
                onBookmark={async (postId) => {
                  await api.toggleBookmark(postId);
                  load();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
