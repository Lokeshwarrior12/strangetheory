import { useEffect, useState } from 'react';
import { ArrowRight, Brain, Clock, Trophy } from 'lucide-react';
import { api } from '../lib/api';
import type { AppRoute } from '../components/nav/Header';
import type { Profile, WeeklyChallengeData } from '../lib/types';

interface WeeklyChallengePageProps {
  currentUser: Profile | null;
  onNavigate: (route: AppRoute) => void;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function WeeklyChallengePage({ currentUser, onNavigate }: WeeklyChallengePageProps) {
  const [data, setData] = useState<WeeklyChallengeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getWeeklyChallenge()
      .then((res) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentUser?.id]);

  if (loading) {
    return <div className="mx-auto max-w-5xl px-6 py-16 text-sm text-slate-400">Loading Weekly Riddle Challenge...</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <p className="font-mono text-xs text-[#A78BFA]">
            Weekly Riddle Challenge · {data?.week_key || 'Current Week'}
          </p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl font-semibold text-white">
            This Week&apos;s Lateral Benchmark
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            One featured riddle per week. Solvers rank by fewest hints used, then fastest solve time.
          </p>
        </div>
        {data && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0E1525] px-3.5 py-2 font-mono text-xs text-slate-300">
            <Clock className="h-3.5 w-3.5 text-[#22D3EE]" />
            Ends {new Date(data.ends_at).toLocaleDateString()}
          </div>
        )}
      </div>

      {data?.riddle ? (
        <section className="rounded-2xl border border-[#A78BFA]/40 bg-[#131D33] p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="flex items-center gap-2 font-mono text-xs text-[#A78BFA]">
              <Brain className="h-4 w-4" />
              <span>
                {data.riddle.riddle?.difficulty} · {data.riddle.riddle?.riddle_type}
              </span>
              {data.riddle.categories[0] && (
                <>
                  <span>·</span>
                  <span style={{ color: data.riddle.categories[0].color }}>{data.riddle.categories[0].name}</span>
                </>
              )}
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white">{data.riddle.title}</h2>
            <p className="text-sm leading-relaxed text-slate-300">{data.riddle.intro}</p>
            {data.user_rank && (
              <p className="font-mono text-xs text-emerald-300">Your current rank: #{data.user_rank}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onNavigate({ name: 'riddle', slug: data.riddle!.slug })}
            className="inline-flex items-center gap-2 rounded-lg bg-[#A78BFA] px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-violet-300 shrink-0"
          >
            {data.riddle.riddle_attempt?.solved ? 'View Solution & Card' : 'Attempt Challenge'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </section>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-10 text-center text-sm text-slate-400">
          No active weekly challenge has been assigned yet.
        </div>
      )}

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-400" />
          <h2 className="font-display text-2xl font-semibold text-white">Top-10 Weekly Solvers</h2>
        </div>

        {!data || data.leaderboard.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-8 text-center text-sm text-slate-400">
            No solvers recorded yet this week. Solve the challenge with 0 hints to claim #1!
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#0E1525]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#070B14] font-mono text-slate-400">
                <tr>
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Thinker</th>
                  <th className="px-4 py-3 text-right">Hints Used</th>
                  <th className="px-4 py-3 text-right">Solve Time</th>
                  <th className="px-4 py-3 text-right">Solved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {data.leaderboard.map((row) => (
                  <tr key={row.user_id} className="hover:bg-[#131D33]/50">
                    <td className="px-4 py-3 font-mono font-semibold text-amber-300">#{row.rank}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onNavigate({ name: 'profile', username: row.username })}
                        className="font-semibold text-white hover:text-[#22D3EE] hover:underline"
                      >
                        {row.display_name}
                      </button>
                      <span className="ml-2 font-mono text-slate-400">@{row.username}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">{row.hints_used}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[#22D3EE]">
                      {formatDuration(row.duration_seconds)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-400">
                      {new Date(row.solved_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
