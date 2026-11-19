import { useEffect, useRef, useState } from 'react';
import { GitFork, Flag, MessageSquarePlus, Sparkles, Brain, Scale, HelpCircle } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { FOCUS_LIMITS } from '../../lib/config';
import { useToast } from '../ui/ToastContext';
import type { CommentLens, EnrichedComment, Profile, ReactionKind } from '../../lib/types';

interface ThreeLensDiscussionProps {
  postId: string;
  currentUser: Profile | null;
  onOpenAuth: () => void;
  onBranchToPost: (commentBody: string) => void;
  onReportComment: (commentId: string, excerpt: string) => void;
  onCountsChanged?: () => void;
}

const LENS_META: Array<{ id: CommentLens; label: string; prompt: string }> = [
  { id: 'ripples', label: 'Ripples', prompt: 'What 1st, 2nd, or 3rd order consequences unfold?' },
  { id: 'stress_test', label: 'Stress Test', prompt: 'Where does the logic crack or overlook edge cases?' },
  { id: 'branches', label: 'Branches', prompt: 'What else could happen if we tweak one premise?' },
];

const COMMENT_RXNS: Array<{ kind: ReactionKind; label: string; icon: typeof Sparkles }> = [
  { kind: 'mind_blown', label: 'Mind-blown', icon: Sparkles },
  { kind: 'strong_logic', label: 'Strong logic', icon: Brain },
  { kind: 'needs_evidence', label: 'Needs evidence', icon: HelpCircle },
  { kind: 'changed_mind', label: 'Changed my mind', icon: Scale },
];

export function ThreeLensDiscussion({
  postId,
  currentUser,
  onOpenAuth,
  onBranchToPost,
  onReportComment,
  onCountsChanged,
}: ThreeLensDiscussionProps) {
  const { pushToast } = useToast();
  const [activeLens, setActiveLens] = useState<CommentLens>('ripples');
  const [sort, setSort] = useState<'top' | 'newest' | 'insightful'>('top');
  const [comments, setComments] = useState<EnrichedComment[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [newBody, setNewBody] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestIdRef = useRef(0);

  const loadComments = async (cursor = 0, append = false) => {
    const reqId = ++requestIdRef.current;
    if (!append) setLoading(true);
    setLoadError(null);
    try {
      const res = await api.getComments(postId, activeLens, sort, cursor, FOCUS_LIMITS.COMMENTS_PAGE_SIZE);
      if (reqId !== requestIdRef.current) return;
      setComments((prev) => (append ? [...prev, ...res.items] : res.items));
      setTotal(res.total);
      setNextCursor(res.next_cursor);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setLoadError(err instanceof ApiError ? err.message : 'Unable to load discussion notes.');
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadComments(0, false);
  }, [postId, activeLens, sort]);

  const handleSubmit = async (e: React.FormEvent, parentId: string | null = null) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    const text = parentId ? replyBody : newBody;
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.addComment(postId, { lens: activeLens, parent_id: parentId, body: text });
      if (parentId) {
        setReplyBody('');
        setReplyingTo(null);
      } else {
        setNewBody('');
      }
      await loadComments(0, false);
      onCountsChanged?.();
      pushToast('Note posted to discussion.', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to post comment.');
    } finally {
      setBusy(false);
    }
  };

  const handleCommentReact = async (commentId: string, kind: ReactionKind) => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    try {
      await api.toggleReaction({ target_type: 'comment', target_id: commentId, kind });
      await loadComments(0, false);
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Could not update reaction.', 'error');
    }
  };

  const activeMeta = LENS_META.find((l) => l.id === activeLens)!;

  return (
    <section aria-label="Three-lens discussion" className="mt-12 border-t border-slate-800 pt-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-white">Three-Lens Discourse</h2>
          <p className="mt-1 text-sm text-slate-400">{activeMeta.prompt}</p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="lens-sort" className="text-slate-400">
            Sort:
          </label>
          <select
            id="lens-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as 'top' | 'newest' | 'insightful')}
            className="rounded-lg border border-slate-700 bg-[#0E1525] px-2.5 py-1.5 font-medium text-slate-100"
          >
            <option value="top">Top</option>
            <option value="newest">Newest</option>
            <option value="insightful">Most insightful</option>
          </select>
        </div>
      </div>

      {/* Lens Tabs */}
      <div role="tablist" aria-label="Analytical discussion lenses" className="mt-5 flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {LENS_META.map((lens, idx) => (
          <button
            key={lens.id}
            id={`lens-tab-${lens.id}`}
            type="button"
            role="tab"
            aria-selected={activeLens === lens.id}
            aria-controls={`lens-panel-${lens.id}`}
            tabIndex={activeLens === lens.id ? 0 : -1}
            onClick={() => {
              setActiveLens(lens.id);
              setReplyingTo(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const delta = e.key === 'ArrowRight' ? 1 : -1;
                const next = LENS_META[(idx + delta + LENS_META.length) % LENS_META.length];
                setActiveLens(next.id);
                setReplyingTo(null);
                document.getElementById(`lens-tab-${next.id}`)?.focus();
              }
            }}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              activeLens === lens.id
                ? 'bg-[#22D3EE] text-slate-950'
                : 'border border-slate-800 bg-[#0E1525] text-slate-300 hover:border-slate-600'
            }`}
          >
            {lens.label}
          </button>
        ))}
      </div>

      {/* Composer */}
      <form onSubmit={(e) => handleSubmit(e, null)} className="mt-5 rounded-xl border border-slate-800 bg-[#0E1525] p-4">
        {error && <p className="mb-3 rounded-lg border border-rose-500/40 bg-rose-950/50 p-2.5 text-xs text-rose-200">{error}</p>}
        <textarea
          rows={3}
          maxLength={FOCUS_LIMITS.MAX_COMMENT_LENGTH}
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder={
            currentUser
              ? `Add a ${activeMeta.label.toLowerCase()} insight (max ${FOCUS_LIMITS.MAX_COMMENT_LENGTH} chars)...`
              : `Sign in to contribute to ${activeMeta.label}...`
          }
          className="w-full resize-y rounded-lg border border-slate-800 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
        />
        <div className="mt-2.5 flex items-center justify-between text-xs text-slate-400">
          <span className="font-mono tabular-nums">
            {newBody.length}/{FOCUS_LIMITS.MAX_COMMENT_LENGTH}
          </span>
          <button
            type="submit"
            disabled={busy || (Boolean(currentUser) && !newBody.trim())}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            {currentUser ? `Post to ${activeMeta.label}` : 'Sign in to Comment'}
          </button>
        </div>
      </form>

      {/* Comments List */}
      <div
        id={`lens-panel-${activeLens}`}
        role="tabpanel"
        aria-labelledby={`lens-tab-${activeLens}`}
        className="mt-6 space-y-4"
      >
        {loading ? (
          <p className="text-sm text-slate-400">Loading {activeMeta.label} notes...</p>
        ) : loadError ? (
          <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-rose-200">{loadError}</p>
            <button
              type="button"
              onClick={() => loadComments(0, false)}
              className="rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
            >
              Retry
            </button>
          </div>
        ) : comments.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-6 text-center text-sm text-slate-400">
            No notes in {activeMeta.label} yet. Start the thread above.
          </div>
        ) : (
          comments.map((c) => {
            const isSelf = currentUser?.id === c.author_id;
            return (
              <article key={c.id} className="rounded-xl border border-slate-800 bg-[#0E1525] p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-100">{c.author.display_name}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-[#22D3EE]">{c.author.synapse_total} Syn</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{new Date(c.created_at).toLocaleDateString()}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onReportComment(c.id, c.body.slice(0, 70))}
                    className="inline-flex items-center gap-1 text-slate-400 hover:text-rose-400"
                  >
                    <Flag className="h-3 w-3" />
                    Report
                  </button>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-slate-200 whitespace-pre-line">{c.body}</p>

                {/* Comment Insight Reactions + Reply + Branch */}
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  {COMMENT_RXNS.map((rxn) => {
                    const Icon = rxn.icon;
                    const count = c.reaction_counts?.[rxn.kind] || 0;
                    const active = c.user_reactions?.includes(rxn.kind);
                    return (
                      <button
                        key={rxn.kind}
                        type="button"
                        disabled={isSelf}
                        onClick={() => handleCommentReact(c.id, rxn.kind)}
                        title={isSelf ? 'Cannot react to your own note' : rxn.label}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors ${
                          active
                            ? 'border-[#22D3EE]/60 bg-[#22D3EE]/15 text-[#22D3EE]'
                            : 'border-slate-800 bg-[#070B14] text-slate-400 hover:border-slate-600 hover:text-slate-200'
                        } disabled:opacity-50`}
                      >
                        <Icon className="h-3 w-3" />
                        <span>{rxn.label}</span>
                        {count > 0 && <span className="font-mono tabular-nums text-slate-200">{count}</span>}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setReplyingTo(replyingTo === c.id ? null : c.id)}
                    className="ml-auto font-medium text-slate-300 hover:text-white"
                  >
                    {replyingTo === c.id ? 'Cancel Reply' : 'Reply'}
                  </button>

                  {activeLens === 'branches' && (
                    <button
                      type="button"
                      onClick={() => onBranchToPost(c.body)}
                      className="inline-flex items-center gap-1 font-medium text-[#A78BFA] hover:underline"
                    >
                      <GitFork className="h-3.5 w-3.5" />
                      Turn Branch into Linked Post
                    </button>
                  )}
                </div>

                {/* 1-Level Reply Form */}
                {replyingTo === c.id && (
                  <form onSubmit={(e) => handleSubmit(e, c.id)} className="mt-3 border-l-2 border-[#22D3EE]/40 pl-4">
                    <textarea
                      rows={2}
                      maxLength={FOCUS_LIMITS.MAX_COMMENT_LENGTH}
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      placeholder="Write a concise reply..."
                      className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
                    />
                    <div className="mt-2 flex justify-end">
                      <button
                        type="submit"
                        disabled={busy || !replyBody.trim()}
                        className="rounded-md bg-[#22D3EE] px-3 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50"
                      >
                        Submit Reply
                      </button>
                    </div>
                  </form>
                )}

                {/* 1-Level Nested Replies */}
                {c.replies && c.replies.length > 0 && (
                  <div className="mt-4 space-y-3 border-l-2 border-slate-700 pl-4">
                    {c.replies.map((r) => (
                      <div key={r.id} className="rounded-lg bg-[#070B14] border border-slate-800/70 p-3">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span className="font-semibold text-slate-200">{r.author.display_name}</span>
                          <span className="tabular-nums">{new Date(r.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="mt-1.5 text-sm text-slate-300">{r.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })
        )}

        {nextCursor !== null && (
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => loadComments(nextCursor, true)}
              className="rounded-lg border border-slate-700 bg-[#0E1525] px-5 py-2 text-xs font-semibold text-slate-200 hover:border-[#22D3EE]"
            >
              Show more ({total - comments.length} remaining)
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
