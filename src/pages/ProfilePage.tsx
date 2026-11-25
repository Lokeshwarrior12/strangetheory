import { useEffect, useState } from 'react';
import { Settings, FileText, Bookmark, ShieldAlert, FolderHeart } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { PostCard } from '../components/ui/PostCard';
import { useToast } from '../components/ui/ToastContext';
import type { AppRoute } from '../components/nav/Header';
import type { CollectionSummary, EnrichedPost, Profile } from '../lib/types';

interface ProfilePageProps {
  username: string;
  currentUser: Profile | null;
  onNavigate: (route: AppRoute) => void;
  onOpenPost: (post: EnrichedPost) => void;
  onOpenAuth: () => void;
}

export function ProfilePage({
  username,
  currentUser,
  onNavigate,
  onOpenPost,
  onOpenAuth,
}: ProfilePageProps) {
  const { pushToast } = useToast();
  const [data, setData] = useState<{
    profile: Profile;
    published: EnrichedPost[];
    drafts: EnrichedPost[];
    bookmarks: EnrichedPost[];
    followers_count: number;
    following_count: number;
    is_following: boolean;
    synapse_events: Array<{ id: string; reason: string; points: number; created_at: string }>;
  } | null>(null);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [visibleLimit, setVisibleLimit] = useState(9);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, colRes] = await Promise.all([
        api.getProfile(username),
        api.getCollections({ username }).catch(() => ({ collections: [] })),
      ]);
      setData(res);
      setCollections(colRes.collections.filter((c) => c.is_public));
      setVisibleLimit(9);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [username]);

  const handleFollow = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!data) return;
    try {
      const res = await api.toggleFollow(data.profile.id);
      setData({
        ...data,
        is_following: res.following,
        followers_count: data.followers_count + (res.following ? 1 : -1),
      });
      pushToast(res.following ? `Following ${data.profile.display_name}` : `Unfollowed ${data.profile.display_name}`, 'info');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to update follow status.', 'error');
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-5xl px-6 py-16 text-sm text-slate-400">Loading thinker profile...</div>;
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">Profile Not Found</h1>
        <p className="mt-2 text-sm text-slate-400">{error || 'This member does not exist.'}</p>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'explore' })}
          className="mt-6 rounded-lg bg-[#22D3EE] px-5 py-2.5 text-sm font-semibold text-slate-950"
        >
          Explore Library
        </button>
      </div>
    );
  }

  const isOwn = currentUser?.id === data.profile.id;
  const visiblePublished = data.published.slice(0, visibleLimit);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Profile Header */}
      <section className="rounded-2xl border border-slate-800 bg-[#0E1525] p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-700 bg-[#131D33] font-display text-2xl font-semibold text-[#22D3EE]">
              {data.profile.avatar_url ? (
                <img src={data.profile.avatar_url} alt={data.profile.display_name} className="h-full w-full object-cover" />
              ) : (
                data.profile.display_name.slice(0, 1).toUpperCase()
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-3xl font-semibold text-white">{data.profile.display_name}</h1>
                {data.profile.role !== 'member' && (
                  <span className="font-mono text-xs text-[#A78BFA]">· {data.profile.role}</span>
                )}
              </div>
              <p className="font-mono text-xs text-slate-400">
                @{data.profile.username} · Joined {new Date(data.profile.created_at).toLocaleDateString()}
              </p>
              {data.profile.bio && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">{data.profile.bio}</p>}
              {data.profile.interests.length > 0 && (
                <p className="mt-2 font-mono text-xs text-slate-400">
                  Interests: {data.profile.interests.join(' · ')}
                </p>
              )}
              {data.profile.badges.length > 0 && (
                <p className="mt-1 font-mono text-xs text-amber-300">
                  Badges: {data.profile.badges.join(' · ')}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isOwn ? (
              <>
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'drafts' })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#131D33] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-[#22D3EE]"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Drafts ({data.drafts.length})
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'bookmarks' })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#131D33] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-[#22D3EE]"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                  Bookmarks ({data.bookmarks.length})
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'settings' })}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#22D3EE] px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleFollow}
                className={`rounded-lg px-5 py-2 text-xs font-semibold ${
                  data.is_following
                    ? 'border border-[#22D3EE] bg-[#22D3EE]/15 text-[#22D3EE]'
                    : 'bg-[#22D3EE] text-slate-950 hover:bg-cyan-300'
                }`}
              >
                {data.is_following ? 'Following' : 'Follow'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-8 border-t border-slate-800 pt-5 text-xs">
          <div>
            <span className="font-mono text-lg font-semibold text-[#22D3EE] tabular-nums">{data.profile.synapse_total}</span>
            <span className="ml-2 text-slate-400">Synapse Score</span>
          </div>
          <div>
            <span className="font-mono text-lg font-semibold text-white tabular-nums">{data.published.length}</span>
            <span className="ml-2 text-slate-400">Published</span>
          </div>
          <div>
            <span className="font-mono text-lg font-semibold text-white tabular-nums">{data.followers_count}</span>
            <span className="ml-2 text-slate-400">Followers</span>
          </div>
          <div>
            <span className="font-mono text-lg font-semibold text-white tabular-nums">{data.following_count}</span>
            <span className="ml-2 text-slate-400">Following</span>
          </div>
        </div>
      </section>

      {isOwn && data.profile.email_verified === false && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/35 bg-amber-950/25 px-5 py-3 text-xs text-amber-200">
          <span className="inline-flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            Your email address has not been verified yet.
          </span>
          <button
            type="button"
            onClick={() => onNavigate({ name: 'settings' })}
            className="font-semibold underline hover:text-white"
          >
            Verify in Settings →
          </button>
        </div>
      )}

      {/* Published Grid (First 9 + See more) */}
      <section className="mt-10">
        <h2 className="font-display text-2xl font-semibold text-white mb-5">
          Published Entries ({data.published.length})
        </h2>
        {data.published.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-8 text-center text-sm text-slate-400">
            No published thought experiments or riddles yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visiblePublished.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onOpenPost={onOpenPost}
                  onOpenAuthor={(u) => onNavigate({ name: 'profile', username: u })}
                />
              ))}
            </div>
            {data.published.length > visibleLimit && (
              <div className="mt-8 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((v) => v + 9)}
                  className="rounded-lg border border-slate-700 bg-[#0E1525] px-5 py-2 text-xs font-semibold text-slate-100 hover:border-[#22D3EE]"
                >
                  See more ({data.published.length - visibleLimit} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Public Collections */}
      {collections.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <FolderHeart className="h-5 w-5 text-[#22D3EE]" />
            <h2 className="font-display text-2xl font-semibold text-white">
              Public Collections ({collections.length})
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {collections.map((col) => (
              <button
                key={col.id}
                type="button"
                onClick={() => onNavigate({ name: 'collection-detail', slug: col.slug })}
                className="rounded-xl border border-slate-800 bg-[#0E1525] p-4 text-left hover:border-[#22D3EE]/60 transition-colors"
              >
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-mono text-[#22D3EE]">Collection</span>
                  <span className="font-mono tabular-nums">{col.item_count} entries</span>
                </div>
                <h3 className="mt-1.5 font-display text-lg font-semibold text-white">{col.title}</h3>
                {col.note && <p className="mt-1 text-xs text-slate-400 line-clamp-2">{col.note}</p>}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Synapse Audit Ledger */}
      <section className="mt-12 rounded-2xl border border-slate-800 bg-[#0E1525] p-6">
        <h2 className="font-display text-xl font-semibold text-white mb-4">Recent Synapse Ledger</h2>
        {data.synapse_events.length === 0 ? (
          <p className="text-sm text-slate-400">No Synapse events recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800/80 text-xs">
            {data.synapse_events.map((ev) => (
              <li key={ev.id} className="flex items-center justify-between gap-4 py-2.5">
                <span className="text-slate-200">{ev.reason}</span>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-mono text-slate-400 tabular-nums">
                    {new Date(ev.created_at).toLocaleDateString()}
                  </span>
                  <span className={`font-mono font-semibold tabular-nums ${ev.points >= 0 ? 'text-[#22D3EE]' : 'text-rose-400'}`}>
                    {ev.points >= 0 ? `+${ev.points}` : ev.points}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
