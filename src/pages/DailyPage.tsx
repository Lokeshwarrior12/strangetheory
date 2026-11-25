import { Sparkles, ArrowRight, Brain, Trophy } from 'lucide-react';
import { RandomSynapseButton } from '../components/ui/RandomSynapseButton';
import type { AppRoute } from '../components/nav/Header';
import type { EnrichedPost } from '../lib/types';

interface DailyPageProps {
  dailyExperiment: EnrichedPost | null;
  dailyRiddle: EnrichedPost | null;
  onNavigate: (route: AppRoute) => void;
  onOpenPost: (post: EnrichedPost) => void;
  onBookmark: (postId: string) => void;
  onRandomPick: () => Promise<void> | void;
}

export function DailyPage({
  dailyExperiment,
  dailyRiddle,
  onNavigate,
  onOpenPost,
  onRandomPick,
}: DailyPageProps) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <p className="font-mono text-xs text-[#22D3EE]">Daily Edition · {new Date().toLocaleDateString()}</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl font-semibold text-white">Daily Picks</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            One curated thought experiment and one lateral riddle rotated every UTC day.
          </p>
        </div>
        <RandomSynapseButton onFire={onRandomPick} label="Surprise Me" />
      </div>

      <div className="mt-10 grid lg:grid-cols-2 gap-8">
        {dailyExperiment && (
          <article className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-[#0E1525] p-7">
            <div>
              {dailyExperiment.cover_url && (
                <img
                  src={dailyExperiment.cover_url}
                  alt={dailyExperiment.title}
                  className="mb-5 aspect-[16/9] w-full rounded-xl object-cover border border-slate-800"
                />
              )}
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Sparkles className="h-3.5 w-3.5 text-[#22D3EE]" />
                <span className="font-semibold text-[#22D3EE]">Thought Experiment of the Day</span>
                <span aria-hidden="true">·</span>
                <span>{dailyExperiment.categories[0]?.name}</span>
              </div>
              <h2 className="mt-3 font-display text-2xl font-semibold text-white leading-snug">
                {dailyExperiment.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">{dailyExperiment.intro}</p>
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-slate-800 pt-4 text-xs text-slate-400">
              <span>
                By{' '}
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'profile', username: dailyExperiment.author.username })}
                  className="font-semibold text-slate-200 hover:text-[#22D3EE] hover:underline"
                >
                  {dailyExperiment.author.display_name}
                </button>
              </span>
              <button
                type="button"
                onClick={() => onOpenPost(dailyExperiment)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
              >
                Read Experiment
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </article>
        )}

        {dailyRiddle && (
          <article className="flex flex-col justify-between rounded-2xl border border-[#A78BFA]/35 bg-[#131D33] p-7">
            <div>
              {dailyRiddle.cover_url && (
                <img
                  src={dailyRiddle.cover_url}
                  alt={dailyRiddle.title}
                  className="mb-5 aspect-[16/9] w-full rounded-xl object-cover border border-slate-700"
                />
              )}
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Brain className="h-3.5 w-3.5 text-[#A78BFA]" />
                <span className="font-semibold text-[#A78BFA]">Riddle of the Day</span>
                <span aria-hidden="true">·</span>
                <span>
                  {dailyRiddle.riddle?.difficulty} / {dailyRiddle.riddle?.riddle_type}
                </span>
              </div>
              <h2 className="mt-3 font-display text-2xl font-semibold text-white leading-snug">
                {dailyRiddle.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">{dailyRiddle.intro}</p>
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-slate-700/70 pt-4 text-xs text-slate-300">
              <span className="font-mono text-amber-300">First-solver bonus: +5 Synapse</span>
              <button
                type="button"
                onClick={() => onOpenPost(dailyRiddle)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#A78BFA] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-violet-300"
              >
                Crack Riddle
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </article>
        )}
      </div>

      <section className="mt-10 rounded-2xl border border-amber-400/35 bg-[#0E1525] p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Trophy className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Weekly Riddle Challenge</h2>
            <p className="text-xs text-slate-400">
              Compete on the weekly top-10 leaderboard ranked by fewest hints, then fastest solve time.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'weekly-riddle' })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
        >
          Open Weekly Challenge
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </section>
    </div>
  );
}
