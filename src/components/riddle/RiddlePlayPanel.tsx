import { useEffect, useRef, useState } from 'react';
import { Eye, Lock, CheckCircle2, HelpCircle, Flag, Sparkles, Brain } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { realtime } from '../../lib/realtime';
import { sanitizeRichText } from '../../lib/sanitize';
import { calculateRiddleSolvePoints } from '../../lib/scoring';
import { FOCUS_LIMITS } from '../../lib/config';
import { useToast } from '../ui/ToastContext';
import { RiddleResultCard } from './RiddleResultCard';
import type { EnrichedComment, EnrichedPost, Profile, ReactionKind } from '../../lib/types';

interface RiddlePlayPanelProps {
  post: EnrichedPost;
  currentUser: Profile | null;
  onPostUpdated: (post: EnrichedPost) => void;
  onOpenAuth: () => void;
  onReportComment: (commentId: string, excerpt: string) => void;
  onUserRefresh: () => void;
}

export function RiddlePlayPanel({
  post,
  currentUser,
  onPostUpdated,
  onOpenAuth,
  onReportComment,
  onUserRefresh,
}: RiddlePlayPanelProps) {
  const { pushToast } = useToast();
  const [answers, setAnswers] = useState<EnrichedComment[]>([]);
  const [locked, setLocked] = useState<boolean>(!(post.riddle_attempt?.answers_unlocked));
  const [totalAnswers, setTotalAnswers] = useState(0);
  const [answerText, setAnswerText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingNewAnswers, setPendingNewAnswers] = useState(0);
  const lastLoadedAtRef = useRef<string | null>(null);
  const baselineTotalRef = useRef(0);

  const isAuthor = currentUser?.id === post.author_id;
  const riddle = post.riddle!;
  const attempt = post.riddle_attempt;
  const totalHints = riddle.total_hints ?? 3;
  const hintsUsed = attempt?.hints_used || 0;
  const potentialPoints = calculateRiddleSolvePoints(riddle.difficulty, hintsUsed, !riddle.accepted_comment_id);

  const loadAnswers = async () => {
    try {
      const res = await api.getComments(post.id, 'answer', 'top', 0, 20);
      setAnswers(res.items);
      setLocked(res.locked);
      setTotalAnswers(res.total);
      setPendingNewAnswers(0);
      baselineTotalRef.current = res.total;
      let maxTs = Date.now();
      for (const item of res.items) {
        const ts = Date.parse(item.created_at);
        if (Number.isFinite(ts) && ts > maxTs) maxTs = ts;
      }
      lastLoadedAtRef.current = new Date(maxTs).toISOString();
    } catch {
      // handled gracefully
    }
  };

  useEffect(() => {
    loadAnswers();
  }, [post.id, attempt?.answers_unlocked, riddle.revealed]);

  useEffect(() => {
    if (locked) return;
    return realtime.subscribeEntryComments({
      postId: post.id,
      lens: 'answer',
      getSince: () => lastLoadedAtRef.current,
      onUpdate: (snap) => {
        const delta = Math.max(snap.new_top_level_count, snap.total_top_level - baselineTotalRef.current);
        if (delta > 0) setPendingNewAnswers(delta);
      },
    });
  }, [post.id, locked]);

  const handleRevealHint = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.revealHint(post.id);
      const refreshed = await api.getPostBySlug(post.slug);
      onPostUpdated(refreshed.post);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to unlock hint.');
    } finally {
      setBusy(false);
    }
  };

  const handleShowAnswers = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    setBusy(true);
    try {
      await api.showAnswers(post.id);
      const refreshed = await api.getPostBySlug(post.slug);
      onPostUpdated(refreshed.post);
      await loadAnswers();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to reveal answers.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!answerText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.addComment(post.id, { lens: 'answer', body: answerText });
      setAnswerText('');
      const refreshed = await api.getPostBySlug(post.slug);
      onPostUpdated(refreshed.post);
      await loadAnswers();
      onUserRefresh();
      pushToast('Answer submitted! Community responses are now unlocked.', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit answer.');
    } finally {
      setBusy(false);
    }
  };

  const handleAccept = async (commentId: string) => {
    setBusy(true);
    try {
      const res = await api.acceptAnswer(post.id, commentId);
      onPostUpdated(res.post);
      await loadAnswers();
      onUserRefresh();
      pushToast('Accepted answer marked and Synapse awarded!', 'success');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to mark accepted answer.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRevealOfficial = async () => {
    setBusy(true);
    try {
      const res = await api.revealExplanation(post.id);
      onPostUpdated(res.post);
      await loadAnswers();
      pushToast('Official solution revealed publicly.', 'info');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to reveal official solution.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleReactAnswer = async (commentId: string, kind: ReactionKind) => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    try {
      await api.toggleReaction({ target_type: 'comment', target_id: commentId, kind });
      await loadAnswers();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to toggle reaction.', 'error');
    }
  };

  return (
    <div className="mt-10 space-y-8">
      {attempt?.solved && <RiddleResultCard post={post} />}

      {/* Progressive Hints Panel */}
      <section className="rounded-xl border border-slate-800 bg-[#0E1525] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-white">Progressive Hints</h2>
            <p className="text-xs text-slate-400">
              Each hint used deducts 1 Synapse from your solve reward (minimum 1 pt). Potential reward:{' '}
              <span className="font-mono font-semibold text-[#22D3EE]">{potentialPoints} Synapse</span>
            </p>
          </div>
          {!isAuthor && hintsUsed < totalHints && !riddle.revealed && (
            <button
              type="button"
              disabled={busy}
              onClick={handleRevealHint}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              Reveal Hint ({hintsUsed}/{totalHints})
            </button>
          )}
        </div>

        <div className="mt-4 space-y-2.5">
          {riddle.hints.length === 0 ? (
            <p className="text-sm text-slate-400">
              No hints unlocked yet. Test your intuition first, or unlock Hint 1 above.
            </p>
          ) : (
            riddle.hints.map((hint, idx) => (
              <div key={idx} className="rounded-lg border border-slate-800 bg-[#070B14] px-4 py-3 text-sm text-slate-200">
                <span className="font-mono text-xs font-semibold text-amber-400 mr-2">HINT {idx + 1}:</span>
                {hint}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Official Answer & Explanation (strictly gated by server) */}
      <section className="rounded-xl border border-slate-800 bg-[#0E1525] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-white">Official Solution</h2>
            <p className="text-xs text-slate-400">
              {riddle.revealed
                ? 'Solution is publicly revealed.'
                : riddle.reveal_mode === 'author'
                  ? 'Reveal rule: Author chooses when to reveal publicly.'
                  : `Auto-reveals on ${new Date(riddle.reveal_at).toLocaleDateString()}.`}
            </p>
          </div>
          {isAuthor && !riddle.revealed && (
            <button
              type="button"
              disabled={busy}
              onClick={handleRevealOfficial}
              className="rounded-lg bg-[#22D3EE] px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
            >
              Reveal Solution Early
            </button>
          )}
        </div>

        {post.riddle_secret ? (
          <div className="mt-4 space-y-3 rounded-lg border border-emerald-500/35 bg-emerald-950/25 p-4">
            {isAuthor && !riddle.revealed && (
              <p className="font-mono text-[11px] uppercase tracking-wider text-emerald-300">
                Author Preview (hidden from readers until revealed)
              </p>
            )}
            <p className="text-sm font-semibold text-white">Answer: {post.riddle_secret.answer_text}</p>
            <div
              className="editorial-prose text-sm text-slate-300"
              dangerouslySetInnerHTML={{ __html: sanitizeRichText(post.riddle_secret.explanation) }}
            />
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-800 bg-[#070B14] p-4 text-sm text-slate-400">
            <Lock className="h-4 w-4 shrink-0 text-[#A78BFA]" />
            <span>
              The official answer and explanation remain sealed on the server until the reveal date or early author reveal.
            </span>
          </div>
        )}
      </section>

      {/* Answer Submission & Spoiler Curtain */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 min-h-[32px]">
          <h2 className="font-display text-2xl font-semibold text-white">Community Answers</h2>
          {!locked && pendingNewAnswers > 0 && (
            <button
              type="button"
              onClick={() => void loadAnswers()}
              className="rounded-lg border border-[#22D3EE]/50 bg-[#22D3EE]/15 px-3 py-1 text-xs font-semibold text-[#22D3EE] hover:bg-[#22D3EE]/25 transition-colors"
            >
              {pendingNewAnswers} new {pendingNewAnswers === 1 ? 'answer' : 'answers'} — Show
            </button>
          )}
        </div>

        <form onSubmit={handleSubmitAnswer} className="rounded-xl border border-slate-800 bg-[#0E1525] p-4">
          {error && <p className="mb-3 rounded-lg border border-rose-500/40 bg-rose-950/50 p-2.5 text-xs text-rose-200">{error}</p>}
          <textarea
            rows={3}
            maxLength={FOCUS_LIMITS.MAX_COMMENT_LENGTH}
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            placeholder={
              currentUser
                ? 'Explain your solution and reasoning...'
                : 'Sign in to submit your answer and unlock community guesses...'
            }
            className="w-full rounded-lg border border-slate-800 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
          />
          <div className="mt-2.5 flex items-center justify-between text-xs text-slate-400">
            <span className="font-mono tabular-nums">
              {answerText.length}/{FOCUS_LIMITS.MAX_COMMENT_LENGTH}
            </span>
            <button
              type="submit"
              disabled={busy || (Boolean(currentUser) && !answerText.trim())}
              className="rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
            >
              {currentUser ? 'Submit Answer' : 'Sign in to Answer'}
            </button>
          </div>
        </form>

        {locked ? (
          <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-8 text-center">
            <Lock className="mx-auto h-6 w-6 text-[#A78BFA]" />
            <p className="mt-3 font-display text-lg font-semibold text-white">
              {totalAnswers} community {totalAnswers === 1 ? 'attempt' : 'attempts'} hidden to prevent spoilers
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Submit your own answer above to unlock the discussion, or reveal answers now.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={handleShowAnswers}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#131D33] px-4 py-2 text-xs font-semibold text-slate-100 hover:border-[#22D3EE]"
            >
              <Eye className="h-3.5 w-3.5" />
              Show answers anyway
            </button>
          </div>
        ) : answers.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-6 text-center text-sm text-slate-400">
            No answers submitted yet. Be the first solver!
          </div>
        ) : (
          <div className="space-y-3">
            {answers.map((ans) => (
              <article
                key={ans.id}
                className={`rounded-xl border p-5 ${
                  ans.is_accepted
                    ? 'border-emerald-500/45 bg-emerald-950/20'
                    : 'border-slate-800 bg-[#0E1525]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-100">{ans.author.display_name}</span>
                    <span className="font-mono text-[#22D3EE]">{ans.author.synapse_total} Syn</span>
                    {ans.is_accepted && (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Accepted Solution
                      </span>
                    )}
                    {isAuthor && !ans.is_accepted && ans.likely_correct && (
                      <span className="font-mono text-amber-300">· Keyword match (likely correct)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {isAuthor && !ans.is_accepted && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAccept(ans.id)}
                        className="rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                      >
                        Mark Correct
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onReportComment(ans.id, ans.body.slice(0, 60))}
                      className="inline-flex items-center gap-1 hover:text-rose-400"
                    >
                      <Flag className="h-3 w-3" />
                      Report
                    </button>
                  </div>
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-slate-200 whitespace-pre-line">{ans.body}</p>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    disabled={currentUser?.id === ans.author_id}
                    onClick={() => handleReactAnswer(ans.id, 'strong_logic')}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${
                      ans.user_reactions?.includes('strong_logic')
                        ? 'border-[#22D3EE]/50 bg-[#22D3EE]/15 text-[#22D3EE]'
                        : 'border-slate-800 bg-[#070B14] text-slate-400 hover:text-white'
                    } disabled:opacity-50`}
                  >
                    <Brain className="h-3 w-3" />
                    Strong logic {ans.reaction_counts?.strong_logic ? `(${ans.reaction_counts.strong_logic})` : ''}
                  </button>
                  <button
                    type="button"
                    disabled={currentUser?.id === ans.author_id}
                    onClick={() => handleReactAnswer(ans.id, 'mind_blown')}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${
                      ans.user_reactions?.includes('mind_blown')
                        ? 'border-[#A78BFA]/50 bg-[#A78BFA]/15 text-[#A78BFA]'
                        : 'border-slate-800 bg-[#070B14] text-slate-400 hover:text-white'
                    } disabled:opacity-50`}
                  >
                    <Sparkles className="h-3 w-3" />
                    Clever {ans.reaction_counts?.mind_blown ? `(${ans.reaction_counts.mind_blown})` : ''}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
