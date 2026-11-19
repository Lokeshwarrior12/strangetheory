import { useEffect, useState } from 'react';
import { BarChart3, PenSquare } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { AppRoute } from '../components/nav/Header';
import type { AuthorDashboardEntry, Profile } from '../lib/types';

interface DashboardPageProps {
  currentUser: Profile | null;
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
}

export function DashboardPage({ currentUser, onNavigate, onOpenAuth }: DashboardPageProps) {
  const [entries, setEntries] = useState<AuthorDashboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .getAuthorDashboard()
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to load dashboard.'))
      .finally(() => setLoading(false));
  }, [currentUser?.id]);

  if (!currentUser) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <BarChart3 className="mx-auto h-10 w-10 text-[#22D3EE]" />
        <h1 className="mt-4 font-display text-3xl font-semibold text-white">Author Dashboard</h1>
        <p className="mt-2 text-sm text-slate-400">
          Sign in to inspect unique views, insight reactions, mind-change shifts, and riddle solve rates on your entries.
        </p>
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

  const topChartEntries = entries.slice(0, 8);
  const maxViews = Math.max(1, ...topChartEntries.map((e) => e.unique_views));

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <p className="font-mono text-xs text-[#22D3EE]">@{currentUser.username} · Author Metrics</p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-white">Author Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">
            Clear, distraction-free telemetry for the entries you have published or drafted.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'write' })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
        >
          <PenSquare className="h-3.5 w-3.5" />
          Write New Entry
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading your entry metrics...</p>
      ) : error ? (
        <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-5 text-sm text-rose-200">
          {error}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-12 text-center">
          <p className="font-display text-xl font-semibold text-white">No authored entries yet</p>
          <p className="mt-2 text-sm text-slate-400">
            Publish your first thought experiment or lateral riddle to view reader metrics here.
          </p>
        </div>
      ) : (
        <>
          {/* Focus Limit: 1 Simple Chart */}
          <section className="rounded-2xl border border-slate-800 bg-[#0E1525] p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="font-display text-lg font-semibold text-white">Unique Views &amp; Insights (Recent Entries)</h2>
              <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#22D3EE]" /> Unique views
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#A78BFA]" /> Insights
                </span>
              </div>
            </div>
            <div className="space-y-3" role="img" aria-label="Bar chart of unique views and insight reactions per entry">
              {topChartEntries.map((item) => {
                const viewPct = Math.round((item.unique_views / maxViews) * 100);
                const insightPct = Math.round((item.insight_reactions / maxViews) * 100);
                return (
                  <div key={item.id} className="grid grid-cols-12 items-center gap-3 text-xs">
                    <span className="col-span-5 sm:col-span-4 truncate text-slate-200 font-medium" title={item.title}>
                      {item.title}
                    </span>
                    <div className="col-span-5 sm:col-span-6 space-y-1">
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div className="h-full bg-[#22D3EE]" style={{ width: `${Math.max(item.unique_views > 0 ? 4 : 0, viewPct)}%` }} />
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div className="h-full bg-[#A78BFA]" style={{ width: `${Math.max(item.insight_reactions > 0 ? 4 : 0, insightPct)}%` }} />
                      </div>
                    </div>
                    <span className="col-span-2 text-right font-mono tabular-nums text-slate-300">
                      {item.unique_views} / {item.insight_reactions}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Focus Limit: 1 Simple Table */}
          <section className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#0E1525]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#070B14] font-mono text-slate-400">
                <tr>
                  <th className="px-4 py-3">Entry</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Unique Views</th>
                  <th className="px-4 py-3 text-right">Insights</th>
                  <th className="px-4 py-3 text-right">Mind Shift</th>
                  <th className="px-4 py-3 text-right">Comments</th>
                  <th className="px-4 py-3 text-right">Solve Rate</th>
                  <th className="px-4 py-3 text-right">Avg Hints</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-[#131D33]/50">
                    <td className="px-4 py-3 font-medium text-white max-w-[240px] truncate">
                      <button
                        type="button"
                        onClick={() =>
                          e.status === 'published'
                            ? onNavigate(e.type === 'riddle' ? { name: 'riddle', slug: e.slug } : { name: 'post', slug: e.slug })
                            : onNavigate({ name: 'write', editId: e.id })
                        }
                        className="hover:text-[#22D3EE] hover:underline text-left truncate max-w-full"
                      >
                        {e.title}
                      </button>
                      {e.status === 'draft' && (
                        <span className="ml-2 font-mono text-[10px] text-amber-300">(draft)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300 capitalize">{e.type}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[#22D3EE]">{e.unique_views}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">{e.insight_reactions}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                      {e.avg_mind_shift === null ? '—' : `${e.avg_mind_shift >= 0 ? '+' : ''}${e.avg_mind_shift} pts`}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">{e.comments_count}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[#A78BFA]">
                      {e.solve_rate === null ? '—' : `${e.solve_rate}%`}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-300">
                      {e.avg_hints_used === null ? '—' : e.avg_hints_used}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
