import { useEffect, useState } from 'react';
import { Shield, AlertTriangle, CheckCircle2, Ban, EyeOff, Eye, Scale } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { AccessDeniedPage } from './AccessDeniedPage';
import { useToast } from '../components/ui/ToastContext';
import type { AppRoute } from '../components/nav/Header';
import type { Profile, UserRole } from '../lib/types';

interface AdminPageProps {
  currentUser: Profile | null;
  mode: 'moderation' | 'admin';
  onOpenAuth: () => void;
  onNavigate: (route: AppRoute) => void;
}

export function AdminPage({ currentUser, mode, onOpenAuth, onNavigate }: AdminPageProps) {
  const { pushToast } = useToast();
  const [reports, setReports] = useState<Awaited<ReturnType<typeof api.getModeration>>['reports']>([]);
  const [appeals, setAppeals] = useState<Awaited<ReturnType<typeof api.getModeration>>['appeals']>([]);
  const [actions, setActions] = useState<Awaited<ReturnType<typeof api.getModeration>>['mod_actions']>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.getAdminOverview>> | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isAuthorized = currentUser && (currentUser.role === 'moderator' || currentUser.role === 'admin');

  const loadAll = async () => {
    if (!isAuthorized) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setForbidden(false);
    setLoadError(null);
    try {
      const [modRes, ovRes] = await Promise.all([api.getModeration(), api.getAdminOverview()]);
      setReports(modRes.reports);
      setAppeals(modRes.appeals);
      setActions(modRes.mod_actions);
      setUsers(modRes.users);
      setOverview(ovRes);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
        setForbidden(true);
      } else {
        setLoadError(err instanceof ApiError ? err.message : 'Unable to reach moderation records. Please retry.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [currentUser?.id, currentUser?.role, mode]);

  if (!isAuthorized || forbidden) {
    return <AccessDeniedPage onNavigate={onNavigate} onOpenAuth={onOpenAuth} isSignedIn={Boolean(currentUser)} />;
  }

  const runAction = async (
    payload: Parameters<typeof api.runModerationAction>[0],
    successMsg: string
  ) => {
    try {
      await api.runModerationAction(payload);
      pushToast(successMsg, 'success');
      await loadAll();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Moderation action failed.', 'error');
    }
  };

  const handleRoleChange = async (userId: string, role: UserRole) => {
    try {
      await api.setUserRole(userId, role);
      pushToast(`Role updated to ${role}.`, 'success');
      await loadAll();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to update role.', 'error');
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs text-[#A78BFA]">
            <Shield className="h-4 w-4" />
            {currentUser.role === 'admin' ? 'Admin & Moderation Console' : 'Moderator Console'}
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold text-white">
            {mode === 'admin' ? 'System & Governance' : 'Moderation Queue'}
          </h1>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => onNavigate({ name: 'moderation' })}
            className={`rounded-lg px-3.5 py-2 font-semibold ${
              mode === 'moderation' ? 'bg-[#22D3EE] text-slate-950' : 'border border-slate-700 bg-[#0E1525] text-slate-300'
            }`}
          >
            Moderation Queue
          </button>
          {currentUser.role === 'admin' && (
            <button
              type="button"
              onClick={() => onNavigate({ name: 'admin' })}
              className={`rounded-lg px-3.5 py-2 font-semibold ${
                mode === 'admin' ? 'bg-[#A78BFA] text-slate-950' : 'border border-slate-700 bg-[#0E1525] text-slate-300'
              }`}
            >
              Admin Overview
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading moderation records...</p>
      ) : loadError ? (
        <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/35 p-5 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-rose-200">{loadError}</p>
          <button
            type="button"
            onClick={loadAll}
            className="rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          {overview && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Total Members', value: overview.counts.totalUsers, color: '#22D3EE' },
                { label: 'Published Entries', value: overview.counts.totalPosts, color: '#34D399' },
                { label: 'Open Reports', value: overview.counts.openReports, color: '#FB7185' },
                { label: 'Open Appeals', value: overview.counts.openAppeals, color: '#A78BFA' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-slate-800 bg-[#0E1525] p-4">
                  <p className="font-mono text-xs text-slate-400">{stat.label}</p>
                  <p className="mt-1 font-display text-2xl font-semibold tabular-nums" style={{ color: stat.color }}>
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Reports Queue */}
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-white">Reports Queue ({reports.length})</h2>
            {reports.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-6 text-sm text-slate-400">
                No reports currently in the queue.
              </div>
            ) : (
              <div className="space-y-4">
                {reports.map((rep) => (
                  <div key={rep.id} className="rounded-xl border border-slate-800 bg-[#0E1525] p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono font-semibold uppercase ${
                            rep.status === 'open' ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {rep.status}
                        </span>
                        <span className="text-slate-400">· {rep.target_type}</span>
                        <span className="text-slate-400">· target status: {rep.target_status}</span>
                        <span className="text-slate-400">· by {rep.reporter_name}</span>
                      </div>
                      <span className="font-mono text-slate-500">{new Date(rep.created_at).toLocaleString()}</span>
                    </div>

                    <p className="text-sm font-semibold text-white">Reason: {rep.reason}</p>
                    <p className="rounded-lg border border-slate-800 bg-[#070B14] px-3 py-2 text-xs text-slate-300">
                      Excerpt ({rep.target_author_name}): {rep.target_excerpt}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <input
                        type="text"
                        placeholder="Moderator note / warning message..."
                        value={noteById[rep.id] || ''}
                        onChange={(e) => setNoteById((prev) => ({ ...prev, [rep.id]: e.target.value }))}
                        className="flex-1 min-w-[200px] rounded-lg border border-slate-700 bg-[#070B14] px-3 py-1.5 text-xs text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          runAction(
                            {
                              report_id: rep.id,
                              target_type: rep.target_type,
                              target_id: rep.target_id,
                              action: 'hide',
                              note: noteById[rep.id] || 'Hidden following report review',
                            },
                            'Target content hidden.'
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        <EyeOff className="h-3.5 w-3.5" /> Hide Content
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runAction(
                            {
                              report_id: rep.id,
                              target_type: rep.target_type,
                              target_id: rep.target_id,
                              action: 'restore',
                              note: noteById[rep.id] || 'Restored after review',
                            },
                            'Target content restored.'
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#131D33] px-3 py-1.5 text-xs font-semibold text-emerald-300"
                      >
                        <Eye className="h-3.5 w-3.5" /> Restore
                      </button>
                      {rep.target_author_id && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              runAction(
                                {
                                  report_id: rep.id,
                                  target_type: 'user',
                                  target_id: rep.target_author_id!,
                                  action: 'warn',
                                  note: noteById[rep.id] || 'Please uphold StrangeTheory civility guidelines.',
                                },
                                'Warning dispatched to author.'
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" /> Warn Author
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              runAction(
                                {
                                  report_id: rep.id,
                                  target_type: 'user',
                                  target_id: rep.target_author_id!,
                                  action: rep.target_author_banned ? 'unban' : 'ban',
                                  note: noteById[rep.id] || 'Account enforcement updated',
                                },
                                rep.target_author_banned ? 'Author unbanned.' : 'Author banned.'
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-300"
                          >
                            <Ban className="h-3.5 w-3.5" /> {rep.target_author_banned ? 'Unban' : 'Ban Author'}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          runAction(
                            {
                              report_id: rep.id,
                              target_type: 'report',
                              target_id: rep.id,
                              action: 'dismiss_report',
                              note: noteById[rep.id] || 'No violation found',
                            },
                            'Report dismissed.'
                          )
                        }
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Appeals Queue */}
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-white flex items-center gap-2">
              <Scale className="h-5 w-5 text-[#A78BFA]" /> Appeals ({appeals.length})
            </h2>
            {appeals.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-6 text-sm text-slate-400">
                No pending or past appeals.
              </div>
            ) : (
              <div className="space-y-3">
                {appeals.map((apl) => (
                  <div key={apl.id} className="rounded-xl border border-slate-800 bg-[#0E1525] p-5 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="font-mono text-xs text-[#A78BFA]">
                        {apl.status.toUpperCase()} · {apl.user_name} ({apl.target_type} {apl.target_id})
                      </p>
                      <p className="mt-1 text-sm text-slate-200">{apl.reason}</p>
                    </div>
                    {apl.status === 'open' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            runAction(
                              {
                                appeal_id: apl.id,
                                target_type: apl.target_type as 'post' | 'comment' | 'user',
                                target_id: apl.target_id,
                                action: 'approve_appeal',
                                note: 'Appeal approved and content restored',
                              },
                              'Appeal approved.'
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            runAction(
                              {
                                appeal_id: apl.id,
                                target_type: apl.target_type as 'post' | 'comment' | 'user',
                                target_id: apl.target_id,
                                action: 'reject_appeal',
                                note: 'Decision upheld',
                              },
                              'Appeal rejected.'
                            )
                          }
                          className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-300"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Admin-Only User Roles & Analytics */}
          {currentUser.role === 'admin' && users.length > 0 && (
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold text-white">Role Management (Admin)</h2>
              <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#0E1525]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-[#131D33] font-mono text-slate-300">
                    <tr>
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3">Synapse</th>
                      <th className="px-4 py-3">Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {users.slice(0, 20).map((u) => (
                      <tr key={u.id}>
                        <td className="px-4 py-3 text-slate-100">
                          {u.display_name} <span className="font-mono text-slate-400">@{u.username}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[#22D3EE]">{u.synapse_total}</td>
                        <td className="px-4 py-3">
                          <select
                            aria-label={`Role for ${u.username}`}
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                            className="rounded border border-slate-700 bg-[#070B14] px-2 py-1 text-slate-100"
                          >
                            <option value="member">member</option>
                            <option value="moderator">moderator</option>
                            <option value="admin">admin</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Privacy-First Analytics & Audit Log */}
          <div className="grid lg:grid-cols-2 gap-6">
            <section className="rounded-2xl border border-slate-800 bg-[#0E1525] p-6">
              <h2 className="font-display text-xl font-semibold text-white mb-4">Moderation Audit Log</h2>
              <ul className="space-y-2.5 text-xs">
                {actions.slice(0, 15).map((a) => (
                  <li key={a.id} className="border-b border-slate-800/70 pb-2 text-slate-300">
                    <span className="font-semibold text-white">{a.moderator_name}</span>{' '}
                    <span className="font-mono text-[#22D3EE]">{a.action}</span> on {a.target_type} ({a.target_id})
                    {a.note ? <p className="text-slate-400 mt-0.5">{a.note}</p> : null}
                  </li>
                ))}
              </ul>
            </section>

            {overview && (
              <section className="rounded-2xl border border-slate-800 bg-[#0E1525] p-6 space-y-5">
                <div>
                  <h2 className="font-display text-xl font-semibold text-white mb-3">Privacy-First Analytics</h2>
                  {overview.analytics.length === 0 ? (
                    <p className="text-xs text-slate-400">Events appear as visitors explore pages.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs">
                      {overview.analytics.map((ev) => (
                        <li key={ev.event_name} className="flex justify-between text-slate-300">
                          <span className="font-mono">{ev.event_name}</span>
                          <span className="font-mono font-semibold text-[#22D3EE]">{ev.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="border-t border-slate-800 pt-4">
                  <h3 className="font-display text-lg font-semibold text-white mb-2">Recent Error Logs</h3>
                  {overview.error_logs.length === 0 ? (
                    <p className="text-xs text-emerald-400">No recorded errors.</p>
                  ) : (
                    <ul className="space-y-2 text-xs text-rose-300">
                      {overview.error_logs.slice(0, 8).map((er) => (
                        <li key={er.id} className="rounded border border-rose-500/20 bg-rose-950/20 p-2">
                          [{er.source}] {er.message} ({er.route})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
