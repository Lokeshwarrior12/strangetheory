import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Award, Brain, Copy, Download, Flame, Share2, Sparkles, X } from 'lucide-react';
import { api, type CategoryWithCount } from '../lib/api';
import { FOCUS_LIMITS } from '../lib/config';
import { downloadMyBrainCardPng } from '../lib/shareCanvas';
import { useToast } from '../components/ui/ToastContext';
import type { AppRoute } from '../components/nav/Header';
import type { MyBrainData, Profile } from '../lib/types';

const LazyNeuralBrainCanvas = lazy(() => import('../components/three/NeuralBrainCanvas'));

interface MyBrainPageProps {
  currentUser: Profile | null;
  categories: CategoryWithCount[];
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
  onOpenPostSlug: (slug: string, kind: 'experiment' | 'riddle') => void;
}

export function MyBrainPage({
  currentUser,
  categories,
  onNavigate,
  onOpenAuth,
  onOpenPostSlug,
}: MyBrainPageProps) {
  const { pushToast } = useToast();
  const [data, setData] = useState<(MyBrainData & { signed_in: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .getMyBrain()
      .then((res) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentUser?.id]);

  const regionGlow = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of data?.region_activity || []) {
      map[r.slug] = r.glow;
      map[r.category_id] = r.glow;
    }
    return map;
  }, [data]);

  const sortedBadges = useMemo(() => {
    const list = [...(data?.badges || [])].slice(0, FOCUS_LIMITS.MAX_BRAIN_BADGES);
    list.sort((a, b) => Number(b.earned) - Number(a.earned) || b.progress / b.target - a.progress / a.target);
    return list;
  }, [data]);

  const visibleBadges = showAllBadges
    ? sortedBadges
    : sortedBadges.slice(0, FOCUS_LIMITS.BRAIN_BADGES_PREVIEW);

  if (!currentUser) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-12 space-y-8">
        <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-8 sm:p-10">
          <p className="font-mono text-xs text-[#22D3EE]">Personal Observatory</p>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-semibold text-white">
            Your 3D Cognitive Brain Map
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
            Track which of the ten brain regions light up as you read thought experiments, solve lateral riddles, and earn region badges. Sign in to activate your personal cortex map.
          </p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="mt-6 rounded-lg bg-[#22D3EE] px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
          >
            Join or Sign in
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#070B14]">
          <Suspense
            fallback={
              <div className="flex h-[380px] items-center justify-center text-sm text-slate-400">
                Loading 3D Neural Preview...
              </div>
            }
          >
            <LazyNeuralBrainCanvas
              categories={categories}
              selectedCategorySlug={null}
              onSelectCategory={(slug) => onNavigate({ name: 'explore', category: slug })}
              onOpenPostSlug={onOpenPostSlug}
              heightClass="h-[380px]"
            />
          </Suspense>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return <div className="mx-auto max-w-6xl px-6 py-16 text-sm text-slate-400">Mapping your neural activity...</div>;
  }

  const { stats } = data;
  const goalPct = Math.min(100, Math.round((stats.weekly_reads / Math.max(1, stats.reading_goal_per_week)) * 100));

  const handleCopySummary = async () => {
    const text = `My ${currentUser.display_name} Brain Map on StrangeTheory: ${stats.entries_read} read · ${stats.riddles_solved} riddles solved · ${stats.regions_explored}/${stats.total_regions} regions explored · ${stats.current_streak}d streak`;
    try {
      await navigator.clipboard.writeText(text);
      pushToast('Brain summary copied to clipboard.', 'success');
    } catch {
      pushToast(text, 'info');
    }
  };

  const handleDownloadCard = () => {
    downloadMyBrainCardPng({
      displayName: currentUser.display_name,
      username: currentUser.username,
      brainData: data,
      categories,
    });
    pushToast('My Brain image card downloaded.', 'success');
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <p className="font-mono text-xs text-[#22D3EE]">@{currentUser.username} · Personal Brain Map</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl font-semibold text-white">My Brain</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Regions glow brighter as you read, solve riddles, and bookmark entries. Click any region to explore it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
        >
          <Share2 className="h-3.5 w-3.5" />
          Share Brain Map
        </button>
      </div>

      {/* Interactive 3D Cortex Map */}
      <section className="grid lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 overflow-hidden rounded-2xl border border-slate-800 bg-[#070B14]">
          <Suspense
            fallback={
              <div className="flex h-[420px] items-center justify-center text-sm text-slate-400">
                Rendering 3D Neural Activity...
              </div>
            }
          >
            <LazyNeuralBrainCanvas
              categories={categories}
              selectedCategorySlug={null}
              regionGlow={regionGlow}
              onSelectCategory={(slug) => onNavigate({ name: 'explore', category: slug })}
              onOpenPostSlug={onOpenPostSlug}
              heightClass="h-[420px] sm:h-[460px]"
            />
          </Suspense>
        </div>

        {/* 5 Core Stats + Weekly Goal */}
        <div className="lg:col-span-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-4">
              <p className="font-mono text-[11px] text-slate-400">Entries read</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-[#22D3EE]">
                {stats.entries_read}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-4">
              <p className="font-mono text-[11px] text-slate-400">Riddles solved</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-[#A78BFA]">
                {stats.riddles_solved}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-4">
              <p className="font-mono text-[11px] text-slate-400">Hints used</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-300">
                {stats.hints_used}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-4">
              <p className="font-mono text-[11px] text-slate-400 flex items-center gap-1">
                <Flame className="h-3.5 w-3.5 text-emerald-400" />
                Current streak
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-300">
                {stats.current_streak}d
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-slate-400">Regions explored</span>
              <span className="font-mono font-semibold tabular-nums text-white">
                {stats.regions_explored} of {stats.total_regions}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-[#22D3EE]"
                style={{ width: `${Math.round((stats.regions_explored / Math.max(1, stats.total_regions)) * 100)}%` }}
              />
            </div>

            <div className="mt-4 flex items-center justify-between text-xs">
              <span className="font-mono text-slate-400">Weekly reading goal</span>
              <span className="font-mono font-semibold tabular-nums text-[#A78BFA]">
                {stats.weekly_reads} / {stats.reading_goal_per_week}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full bg-[#A78BFA]" style={{ width: `${goalPct}%` }} />
            </div>
          </div>
        </div>
      </section>

      {/* Badges (max 12 total, 3 at a time + See all) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-semibold text-white">Brain-Region Badges</h2>
            <p className="text-xs text-slate-400">
              Showing {visibleBadges.length} of {sortedBadges.length} milestones
            </p>
          </div>
          {sortedBadges.length > FOCUS_LIMITS.BRAIN_BADGES_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAllBadges((v) => !v)}
              className="text-xs font-semibold text-[#22D3EE] hover:underline"
            >
              {showAllBadges ? 'Show top 3' : `See all (${sortedBadges.length})`}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {visibleBadges.map((b) => (
            <div
              key={b.id}
              className={`rounded-xl border p-4 ${
                b.earned ? 'border-[#22D3EE]/50 bg-[#131D33]' : 'border-slate-800 bg-[#0E1525] opacity-85'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 shrink-0" style={{ color: b.earned ? b.color : '#64748B' }} />
                  <h3 className="text-sm font-semibold text-white">{b.name}</h3>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-slate-300">
                  {Math.min(b.progress, b.target)}/{b.target}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">{b.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Region Activity List (Click to Explore filtered) */}
      <section className="space-y-4">
        <h2 className="font-display text-2xl font-semibold text-white">Activity by Brain Region</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {data.region_activity.map((r) => (
            <button
              key={r.category_id}
              type="button"
              onClick={() => onNavigate({ name: 'explore', category: r.slug })}
              className="rounded-xl border border-slate-800 bg-[#0E1525] p-4 text-left hover:border-slate-600 transition-colors"
              style={
                r.glow > 0
                  ? { boxShadow: `inset 0 0 0 1px ${r.color}${Math.round(r.glow * 90).toString(16).padStart(2, '0')}` }
                  : undefined
              }
            >
              <div className="flex items-center justify-between">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: r.color }} />
                <span className="font-mono text-[11px] tabular-nums text-slate-400">
                  {r.reads}r · {r.solves}s
                </span>
              </div>
              <p className="mt-2 text-xs font-semibold text-white">{r.name}</p>
              <p className="font-mono text-[11px] text-slate-400">{r.brain_region}</p>
            </button>
          ))}
        </div>
      </section>

      {shareOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Share My Brain Card"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#0E1525] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-xs text-[#22D3EE]">
                <Brain className="h-4 w-4" />
                Share Brain Map Card
              </div>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                aria-label="Close share dialog"
                className="rounded p-1 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 rounded-xl border border-slate-800 bg-[#070B14] p-4 space-y-2 text-xs">
              <p className="font-display text-lg font-semibold text-white">{currentUser.display_name}</p>
              <p className="font-mono text-slate-300">
                {stats.entries_read} read · {stats.riddles_solved} solved · {stats.hints_used} hints ·{' '}
                {stats.current_streak}d streak · {stats.regions_explored}/{stats.total_regions} regions
              </p>
            </div>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={handleDownloadCard}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
              >
                <Download className="h-3.5 w-3.5" />
                Download image
              </button>
              <button
                type="button"
                onClick={handleCopySummary}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#131D33] px-4 py-2 text-xs font-semibold text-slate-100 hover:border-[#22D3EE]"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy summary
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
