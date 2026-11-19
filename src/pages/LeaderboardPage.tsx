import { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import { api } from '../lib/api';
import type { AppRoute } from '../components/nav/Header';

interface LeaderboardPageProps {
  onNavigate: (route: AppRoute) => void;
}

export function LeaderboardPage({ onNavigate }: LeaderboardPageProps) {
  const [windowKey, setWindowKey] = useState<'week' | 'month' | 'all'>('all');
  const [leaders, setLeaders] = useState<
    Array<{
      rank: number;
      id: string;
      username: string;
      display_name: string;
      role: string;
      synapse_total: number;
      badges: string[];
      posts_count: number;
      riddles_solved: number;
    }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getLeaderboard(windowKey)
      .then((res) => setLeaders(res.leaders))
      .finally(() => setLoading(false));
  }, [windowKey]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-white">Synapse Leaderboard</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Synapse rewards verified insight, published experiments, and solved riddles — derived from an append-only ledger.
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-slate-700 bg-[#0E1525] p-1 text-xs font-semibold">
          {([
            { id: 'week', label: 'Week' },
            { id: 'month', label: 'Month' },
            { id: 'all', label: 'All-Time' },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setWindowKey(tab.id)}
              className={`rounded-md px-3.5 py-1.5 transition-colors ${
                windowKey === tab.id ? 'bg-[#22D3EE] text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid lg:grid-cols-12 gap-8 items-start">
        {/* Rankings Table */}
        <div className="lg:col-span-8 overflow-hidden rounded-2xl border border-slate-800 bg-[#0E1525]">
          {loading ? (
            <p className="p-8 text-sm text-slate-400">Computing Synapse rankings...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 bg-[#131D33] font-mono text-xs text-slate-300">
                  <tr>
                    <th className="px-5 py-3.5">#</th>
                    <th className="px-5 py-3.5">Thinker</th>
                    <th className="px-5 py-3.5 text-right">Published</th>
                    <th className="px-5 py-3.5 text-right">Solved</th>
                    <th className="px-5 py-3.5 text-right">Synapse</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {leaders.map((row) => (
                    <tr key={row.id} className="hover:bg-[#131D33]/60 transition-colors">
                      <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-400 tabular-nums">
                        {row.rank <= 3 ? (
                          <span className="inline-flex items-center gap-1 text-amber-400">
                            <Award className="h-3.5 w-3.5" />
                            {row.rank}
                          </span>
                        ) : (
                          row.rank
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() => onNavigate({ name: 'profile', username: row.username })}
                          className="font-semibold text-slate-100 hover:text-[#22D3EE] hover:underline"
                        >
                          {row.display_name}
                        </button>
                        <p className="font-mono text-xs text-slate-400">
                          @{row.username}
                          {row.badges[0] ? ` · ${row.badges[0]}` : ''}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-right font-mono text-slate-300 tabular-nums">{row.posts_count}</td>
                      <td className="px-5 py-4 text-right font-mono text-slate-300 tabular-nums">{row.riddles_solved}</td>
                      <td className="px-5 py-4 text-right font-mono font-semibold text-[#22D3EE] tabular-nums">
                        {row.synapse_total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Scoring Rules Sidebar */}
        <aside className="lg:col-span-4 rounded-2xl border border-slate-800 bg-[#0E1525] p-6 space-y-4">
          <h2 className="font-display text-xl font-semibold text-white">How Synapse Works</h2>
          <p className="text-xs leading-relaxed text-slate-400">
            Every Synapse point is recorded in an immutable audit ledger. Self-reactions are blocked server-side.
          </p>
          <ul className="space-y-3 border-t border-slate-800 pt-4 text-xs text-slate-300">
            <li className="flex justify-between gap-2">
              <span>Publish thought experiment or riddle</span>
              <span className="font-mono font-semibold text-[#22D3EE]">+5</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Insight reaction received (post or comment)</span>
              <span className="font-mono font-semibold text-[#22D3EE]">+2</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Constructive discussion note</span>
              <span className="font-mono font-semibold text-[#22D3EE]">+2</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Solve Easy / Medium / Hard riddle</span>
              <span className="font-mono font-semibold text-[#A78BFA]">+3 / +6 / +10</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Hint penalty (minimum 1 pt)</span>
              <span className="font-mono font-semibold text-amber-400">-1 / hint</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>First-solver bonus</span>
              <span className="font-mono font-semibold text-emerald-400">+5</span>
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
