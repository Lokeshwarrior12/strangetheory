import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Search, Network, LayoutGrid, Trophy, ArrowRight } from 'lucide-react';
import { api, ApiError, type CategoryWithCount } from '../lib/api';
import { FOCUS_LIMITS } from '../lib/config';
import { PostCard } from '../components/ui/PostCard';
import { PostCardSkeleton } from '../components/ui/Skeleton';
import { RandomSynapseButton } from '../components/ui/RandomSynapseButton';
import type { AppRoute } from '../components/nav/Header';
import type { EnrichedPost } from '../lib/types';

const LazyNeuralBrainCanvas = lazy(() => import('../components/three/NeuralBrainCanvas'));

interface ExplorePageProps {
  categories: CategoryWithCount[];
  initialCategory?: string;
  initialType?: string;
  initialView?: 'list' | 'graph';
  onNavigate: (route: AppRoute) => void;
  onOpenPost: (post: EnrichedPost) => void;
  onOpenPostSlug: (slug: string, kind: 'experiment' | 'riddle') => void;
  onBookmark: (postId: string) => void;
  onRandomPick: () => Promise<void> | void;
}

export function ExplorePage({
  categories,
  initialCategory,
  initialType = 'all',
  initialView = 'list',
  onNavigate,
  onOpenPost,
  onOpenPostSlug,
  onBookmark,
  onRandomPick,
}: ExplorePageProps) {
  const [selectedCats, setSelectedCats] = useState<string[]>(
    initialCategory ? initialCategory.split(',').filter(Boolean).slice(0, FOCUS_LIMITS.MAX_ACTIVE_CATEGORIES) : []
  );
  const [typeFilter, setTypeFilter] = useState<string>(initialType || 'all');
  const [sort, setSort] = useState<'trending' | 'newest' | 'discussed'>('trending');
  const [viewMode, setViewMode] = useState<'list' | 'graph'>(initialView);
  const [searchText, setSearchText] = useState('');
  const [items, setItems] = useState<EnrichedPost[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterHint, setFilterHint] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setTypeFilter(initialType || 'all');
  }, [initialType]);

  useEffect(() => {
    setViewMode(initialView);
  }, [initialView]);

  useEffect(() => {
    if (initialCategory) {
      setSelectedCats(initialCategory.split(',').filter(Boolean).slice(0, FOCUS_LIMITS.MAX_ACTIVE_CATEGORIES));
    } else {
      setSelectedCats([]);
    }
  }, [initialCategory]);

  const loadFeed = async (cursor = 0, append = false) => {
    const reqId = ++requestIdRef.current;
    if (!append) setLoading(true);
    setLoadError(null);
    try {
      const res = await api.getPosts({
        category: selectedCats.join(','),
        type: typeFilter,
        sort,
        cursor,
        limit: FOCUS_LIMITS.EXPLORE_PAGE_SIZE,
      });
      if (reqId !== requestIdRef.current) return;
      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      setTotal(res.total);
      setNextCursor(res.next_cursor);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setLoadError(err instanceof ApiError ? err.message : 'Unable to load entries right now.');
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadFeed(0, false);
  }, [selectedCats, typeFilter, sort]);

  const toggleRegion = (slug: string) => {
    setFilterHint(null);
    setSelectedCats((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= FOCUS_LIMITS.MAX_ACTIVE_CATEGORIES) {
        setFilterHint(`Focus limit: up to ${FOCUS_LIMITS.MAX_ACTIVE_CATEGORIES} brain regions can be active together.`);
        return [prev[1], slug];
      }
      return [...prev, slug];
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchText.trim()) {
      onNavigate({ name: 'search', q: searchText.trim() });
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-white">
            {typeFilter === 'riddle' ? 'Lateral Riddles' : 'Explore the Observatory'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Filter by up to two brain-region categories, search across all theories, or roam the 3D Idea Graph.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RandomSynapseButton onFire={onRandomPick} />
          <div className="inline-flex rounded-lg border border-slate-700 bg-[#0E1525] p-1">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
                viewMode === 'list' ? 'bg-[#22D3EE] text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Grid
            </button>
            <button
              type="button"
              onClick={() => setViewMode('graph')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
                viewMode === 'graph' ? 'bg-[#22D3EE] text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              <Network className="h-3.5 w-3.5" />
              Idea Graph
            </button>
          </div>
        </div>
      </div>

      {typeFilter === 'riddle' && (
        <div className="mt-6 rounded-2xl border border-amber-400/35 bg-[#0E1525] p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Trophy className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-display text-lg font-semibold text-white">Weekly Riddle Challenge</h2>
              <p className="text-xs text-slate-400">
                Try this week&apos;s featured puzzle and rank on the top-10 leaderboard by fewest hints and fastest solve time.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate({ name: 'weekly-riddle' })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
          >
            View Weekly Challenge
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Controls Bar */}
      <div className="mt-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search titles, intros, tags, or authors..."
              className="w-full rounded-lg border border-slate-700 bg-[#0E1525] py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg border border-slate-700 bg-[#131D33] px-3.5 py-2 text-xs font-semibold text-slate-100 hover:border-[#22D3EE]"
          >
            Search
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="inline-flex rounded-lg border border-slate-700 bg-[#0E1525] p-1">
            {[
              { id: 'all', label: 'All' },
              { id: 'experiment', label: 'Experiments' },
              { id: 'riddle', label: 'Riddles' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTypeFilter(t.id)}
                className={`rounded-md px-3 py-1 font-semibold ${
                  typeFilter === t.id ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Sort posts"
            value={sort}
            onChange={(e) => setSort(e.target.value as 'trending' | 'newest' | 'discussed')}
            className="rounded-lg border border-slate-700 bg-[#0E1525] px-3 py-2 text-xs font-semibold text-slate-100"
          >
            <option value="trending">Trending</option>
            <option value="newest">Newest</option>
            <option value="discussed">Most discussed</option>
          </select>
        </div>
      </div>

      {/* Brain Region Filter Strip (Max 2 active) */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setSelectedCats([]);
            setFilterHint(null);
          }}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
            selectedCats.length === 0
              ? 'border-[#22D3EE] bg-[#22D3EE]/15 text-[#22D3EE]'
              : 'border-slate-800 bg-[#0E1525] text-slate-400 hover:text-white'
          }`}
        >
          All Regions
        </button>
        {categories.map((cat) => {
          const active = selectedCats.includes(cat.slug);
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => toggleRegion(cat.slug)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-white/70 bg-[#131D33] text-white font-semibold'
                  : 'border-slate-800 bg-[#0E1525] text-slate-400 hover:border-slate-600 hover:text-slate-200'
              }`}
            >
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: cat.color }} />
              {cat.name}
            </button>
          );
        })}
      </div>
      {filterHint && <p className="mt-2 font-mono text-xs text-amber-400">{filterHint}</p>}

      {viewMode === 'graph' ? (
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-800 bg-[#070B14]">
          <Suspense
            fallback={
              <div className="flex h-[560px] items-center justify-center text-sm text-slate-400">
                Loading 3D Idea Graph...
              </div>
            }
          >
            <LazyNeuralBrainCanvas
              categories={categories}
              selectedCategorySlug={selectedCats[0] || null}
              onSelectCategory={(slug) => toggleRegion(slug)}
              onOpenPostSlug={onOpenPostSlug}
              initialMode="graph"
              heightClass="h-[560px]"
            />
          </Suspense>
        </div>
      ) : (
        <div className="mt-8">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, idx) => (
                <PostCardSkeleton key={idx} />
              ))}
            </div>
          ) : loadError ? (
            <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-8 text-center">
              <p className="font-display text-xl font-semibold text-white">Could not load entries</p>
              <p className="mt-2 text-sm text-rose-200">{loadError}</p>
              <button
                type="button"
                onClick={() => loadFeed(0, false)}
                className="mt-5 rounded-lg bg-[#22D3EE] px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
              >
                Retry
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-12 text-center">
              <p className="font-display text-xl font-semibold text-white">No entries match those filters</p>
              <p className="mt-2 text-sm text-slate-400">Clear a brain-region filter or try another content type.</p>
            </div>
          ) : (
            <>
              <div className="mb-4 text-xs font-mono text-slate-400 tabular-nums">
                Showing {items.length} of {total} entries
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {items.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onOpenPost={onOpenPost}
                    onOpenAuthor={(username) => onNavigate({ name: 'profile', username })}
                    onBookmark={onBookmark}
                  />
                ))}
              </div>
              {nextCursor !== null && (
                <div className="mt-10 text-center">
                  <button
                    type="button"
                    onClick={() => loadFeed(nextCursor, true)}
                    className="rounded-lg border border-slate-700 bg-[#0E1525] px-6 py-2.5 text-sm font-semibold text-slate-100 hover:border-[#22D3EE]"
                  >
                    Load more ({total - items.length} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
