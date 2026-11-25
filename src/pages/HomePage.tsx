import { lazy, Suspense, useState } from 'react';
import { ArrowRight, Brain, Compass, Search, Sparkles } from 'lucide-react';
import type { CategoryWithCount } from '../lib/api';
import { APP_NAME, FOCUS_LIMITS } from '../lib/config';
import { PostCard } from '../components/ui/PostCard';
import { RandomSynapseButton } from '../components/ui/RandomSynapseButton';
import type { AppRoute } from '../components/nav/Header';
import type { EnrichedPost, Profile } from '../lib/types';

const LazyNeuralBrainCanvas = lazy(() => import('../components/three/NeuralBrainCanvas'));

interface HomePageProps {
  currentUser: Profile | null;
  categories: CategoryWithCount[];
  dailyExperiment: EnrichedPost | null;
  dailyRiddle: EnrichedPost | null;
  forYouPosts: EnrichedPost[];
  forYouPersonalized: boolean;
  trendingPosts: EnrichedPost[];
  recentPosts: EnrichedPost[];
  onNavigate: (route: AppRoute) => void;
  onOpenPost: (post: EnrichedPost) => void;
  onOpenPostSlug: (slug: string, kind: 'experiment' | 'riddle') => void;
  onBookmark: (postId: string) => void;
  onRandomPick: () => Promise<void> | void;
}

export function HomePage({
  currentUser,
  categories,
  dailyExperiment,
  dailyRiddle,
  forYouPosts,
  forYouPersonalized,
  trendingPosts,
  recentPosts,
  onNavigate,
  onOpenPost,
  onOpenPostSlug,
  onBookmark,
  onRandomPick,
}: HomePageProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');

  const handleHeroSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q) {
      onNavigate({ name: 'search', q });
    } else {
      onNavigate({ name: 'explore' });
    }
  };

  return (
    <div>
      {/* Dark Observatory Hero with Scroll-Driven 3D Particle Brain */}
      <section className="relative border-b border-slate-800/80 bg-[#070B14] text-slate-100">
        <div className="mx-auto max-w-6xl px-6 pt-10 pb-8 lg:pt-12 lg:pb-10">
          <div className="grid lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-5 space-y-5">
              <p className="font-mono text-xs text-[#22D3EE]">
                {APP_NAME} · Cognitive Observatory
              </p>
              <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-white leading-[1.08]">
                Where big &ldquo;What if&rdquo; questions meet clear thinking.
              </h1>
              <p className="text-base leading-relaxed text-slate-300">
                Publish structured thought experiments, stress-test edge cases across three analytical lenses, and crack spoiler-protected lateral riddles.
              </p>

              <form onSubmit={handleHeroSearch} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search experiments, riddles, tags, thinkers..."
                    aria-label="Search StrangeTheory"
                    className="w-full rounded-lg border border-slate-700/80 bg-[#0E1525] py-2.5 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg border border-slate-700 bg-[#131D33] px-4 py-2.5 text-xs font-semibold text-slate-100 hover:border-[#22D3EE]"
                >
                  Search
                </button>
              </form>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'explore' })}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#22D3EE] px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 transition-colors"
                >
                  Explore Library
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'write' })}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0E1525] px-4 py-2.5 text-sm font-medium text-slate-100 hover:border-[#A78BFA]"
                >
                  Write a Theory
                </button>
                <RandomSynapseButton onFire={onRandomPick} label="Random" />
              </div>
            </div>

            <div className="lg:col-span-7 overflow-hidden rounded-2xl border border-slate-800 bg-[#070B14] shadow-2xl">
              <Suspense
                fallback={
                  <div className="flex h-[380px] sm:h-[460px] lg:h-[520px] items-center justify-center bg-[#070B14] text-sm text-slate-400">
                    Initializing 3D Neural Observatory...
                  </div>
                }
              >
                <LazyNeuralBrainCanvas
                  categories={categories}
                  selectedCategorySlug={selectedSlug}
                  onSelectCategory={(slug) => {
                    setSelectedSlug(slug);
                    onNavigate({ name: 'explore', category: slug });
                  }}
                  onOpenPostSlug={onOpenPostSlug}
                  enableScrollMotion
                  heightClass="h-[380px] sm:h-[460px] lg:h-[520px]"
                />
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      {/* Ten Brain-Region Domains */}
      <section className="mx-auto max-w-6xl px-6 py-12 border-b border-slate-800/70">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="font-display text-2xl font-semibold text-white">Ten Cognitive Domains</h2>
            <p className="mt-1 text-sm text-slate-400">
              Each region on the neural cortex maps to an independent branch of inquiry.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate({ name: 'explore', view: 'graph' })}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#22D3EE] hover:underline"
          >
            <Compass className="h-3.5 w-3.5" />
            Open 3D Idea Graph
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => onNavigate({ name: 'explore', category: cat.slug })}
              className="group flex flex-col justify-between rounded-xl border border-slate-800/80 bg-[#0E1525] p-4 text-left transition-colors hover:border-slate-600"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: cat.color }} />
                  <span className="font-mono text-[11px] tabular-nums text-slate-400">{cat.post_count} entries</span>
                </div>
                <p className="mt-2.5 text-sm font-semibold text-slate-100 group-hover:text-[#22D3EE] transition-colors">
                  {cat.name}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">{cat.brain_region}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Focus Limit: 1 Featured Daily Spotlight + Riddle of the Day Teaser */}
      {dailyExperiment && (
        <section className="mx-auto max-w-6xl px-6 py-12 border-b border-slate-800/70">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-2xl font-semibold text-white">Featured Today</h2>
            <button
              type="button"
              onClick={() => onNavigate({ name: 'daily' })}
              className="text-xs font-semibold text-[#22D3EE] hover:underline"
            >
              View Daily Picks →
            </button>
          </div>

          <div className="grid lg:grid-cols-12 gap-6 items-stretch">
            <article className="lg:col-span-8 flex flex-col justify-between rounded-2xl border border-slate-800 bg-[#0E1525] p-6 sm:p-8">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="font-mono font-semibold text-[#22D3EE]">Featured Thought Experiment</span>
                  <span aria-hidden="true">·</span>
                  <span>{dailyExperiment.categories[0]?.name}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{dailyExperiment.reading_minutes} min read</span>
                </div>
                <h3 className="mt-3 font-display text-2xl sm:text-3xl font-semibold text-white leading-tight">
                  <button
                    type="button"
                    onClick={() => onOpenPost(dailyExperiment)}
                    className="text-left hover:text-[#22D3EE] transition-colors"
                  >
                    {dailyExperiment.title}
                  </button>
                </h3>
                <p className="mt-3 text-base leading-relaxed text-slate-300">{dailyExperiment.intro}</p>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-4 text-xs text-slate-400">
                <span>
                  By{' '}
                  <button
                    type="button"
                    onClick={() => onNavigate({ name: 'profile', username: dailyExperiment.author.username })}
                    className="font-semibold text-slate-100 hover:text-[#22D3EE] hover:underline"
                  >
                    {dailyExperiment.author.display_name}
                  </button>
                </span>
                <button
                  type="button"
                  onClick={() => onOpenPost(dailyExperiment)}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#22D3EE] hover:underline"
                >
                  Read &amp; Stress-Test
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>

            {dailyRiddle && (
              <aside className="lg:col-span-4 flex flex-col justify-between rounded-2xl border border-[#A78BFA]/30 bg-[#131D33] p-6 text-slate-100">
                <div>
                  <div className="flex items-center gap-2 font-mono text-xs text-[#A78BFA]">
                    <Brain className="h-3.5 w-3.5" />
                    Riddle of the Day · {dailyRiddle.riddle?.difficulty}
                  </div>
                  <h3 className="mt-3 font-display text-xl font-semibold text-white leading-snug">
                    {dailyRiddle.title}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-300">{dailyRiddle.intro}</p>
                </div>

                <div className="mt-6 flex items-center justify-between border-t border-slate-700/70 pt-4">
                  <span className="font-mono text-xs text-amber-300">
                    Up to +
                    {(dailyRiddle.riddle?.difficulty === 'Hard'
                      ? 10
                      : dailyRiddle.riddle?.difficulty === 'Medium'
                        ? 6
                        : 3) + 5}{' '}
                    Synapse
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenPost(dailyRiddle)}
                    className="rounded-lg bg-[#A78BFA] px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-violet-300"
                  >
                    Solve Riddle
                  </button>
                </div>
              </aside>
            )}
          </div>
        </section>
      )}

      {/* Focus Limit: <=6 For You (signed-in) or Trending Now (visitor) */}
      <section className="mx-auto max-w-6xl px-6 py-12 border-b border-slate-800/70">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="font-display text-2xl font-semibold text-white">
              {currentUser ? 'For You' : 'Trending Now'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {currentUser
                ? forYouPersonalized
                  ? 'Ranked around your favorite brain regions, reading history, and bookmarks.'
                  : 'Curated starting picks — explore regions or bookmark entries to tune this row.'
                : 'High-signal thought experiments and riddles sparking active discourse.'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {currentUser && (
              <button
                type="button"
                onClick={() => onNavigate({ name: 'my-brain' })}
                className="text-xs font-semibold text-[#A78BFA] hover:underline"
              >
                Open My Brain →
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate({ name: 'explore' })}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#22D3EE] hover:underline"
            >
              Browse Full Library
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(currentUser && forYouPosts.length > 0 ? forYouPosts : trendingPosts)
            .slice(0, FOCUS_LIMITS.HOME_FOR_YOU)
            .map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onOpenPost={onOpenPost}
                onOpenAuthor={(username) => onNavigate({ name: 'profile', username })}
                onBookmark={onBookmark}
              />
            ))}
        </div>
      </section>

      {/* Focus Limit: 6 Recent */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="font-display text-2xl font-semibold text-white">Recently Published</h2>
            <p className="mt-1 text-sm text-slate-400">
              Fresh premises and lateral challenges added to the observatory.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate({ name: 'riddles' })}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#A78BFA] hover:underline"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Explore Riddles
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(() => {
            const trendingIds = new Set(trendingPosts.slice(0, FOCUS_LIMITS.HOME_TRENDING).map((p) => p.id));
            const uniqueRecent = recentPosts.filter((p) => !trendingIds.has(p.id));
            const displayRecent = (uniqueRecent.length >= FOCUS_LIMITS.HOME_RECENT
              ? uniqueRecent
              : [...uniqueRecent, ...recentPosts.filter((p) => trendingIds.has(p.id))]
            ).slice(0, FOCUS_LIMITS.HOME_RECENT);
            return displayRecent.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onOpenPost={onOpenPost}
                onOpenAuthor={(username) => onNavigate({ name: 'profile', username })}
                onBookmark={onBookmark}
              />
            ));
          })()}
        </div>
      </section>
    </div>
  );
}
