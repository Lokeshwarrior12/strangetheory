import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Flag,
  GitFork,
  Share2,
  Sparkles,
  Brain,
  HelpCircle,
  Scale,
  Edit3,
  Trash2,
  ArrowUpRight,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { sanitizeRichText } from '../lib/sanitize';
import { applySeo } from '../lib/seo';
import { ThreeLensDiscussion } from '../components/discussion/ThreeLensDiscussion';
import { NeuronProgressBar } from '../components/ui/NeuronProgressBar';
import { DetailSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/ToastContext';
import { ReadingControls, readerProseClass, useReaderSizePreference } from '../components/reader/ReadingControls';
import { ShareCardModal } from '../components/share/ShareCardModal';
import { AddToCollectionMenu } from '../components/collections/AddToCollectionMenu';
import type { AppRoute } from '../components/nav/Header';
import type { EnrichedPost, Profile, ReactionKind } from '../lib/types';

interface PostDetailPageProps {
  slug: string;
  currentUser: Profile | null;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
  onReport: (target: { type: 'post' | 'comment'; id: string; label: string }) => void;
  onBranchWithPremise: (forkId: string, bodyText: string) => void;
  onUserRefresh: () => void;
}

const REACTIONS: Array<{ kind: ReactionKind; label: string; icon: typeof Sparkles }> = [
  { kind: 'mind_blown', label: 'Mind-blown', icon: Sparkles },
  { kind: 'strong_logic', label: 'Strong logic', icon: Brain },
  { kind: 'needs_evidence', label: 'Needs evidence', icon: HelpCircle },
  { kind: 'changed_mind', label: 'Changed my mind', icon: Scale },
];

export function PostDetailPage({
  slug,
  currentUser,
  focusMode,
  onToggleFocusMode,
  onNavigate,
  onOpenAuth,
  onReport,
  onBranchWithPremise,
  onUserRefresh,
}: PostDetailPageProps) {
  const { pushToast } = useToast();
  const [textSize, setTextSize] = useReaderSizePreference();
  const [post, setPost] = useState<EnrichedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const [beforeScore, setBeforeScore] = useState(50);
  const [afterScore, setAfterScore] = useState(65);
  const [savingMeter, setSavingMeter] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lastSavedPctRef = useRef(0);

  const loadPost = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPostBySlug(slug);
      setPost(res.post);
      if (res.post.mind_change?.user_before !== null && res.post.mind_change?.user_before !== undefined) {
        setBeforeScore(res.post.mind_change.user_before);
      }
      if (res.post.mind_change?.user_after !== null && res.post.mind_change?.user_after !== undefined) {
        setAfterScore(res.post.mind_change.user_after);
      }
      applySeo({
        title: res.post.title,
        description: res.post.intro,
        ogImage: `/api/og/${res.post.slug}.svg`,
        canonicalPath: `/post/${res.post.slug}`,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: res.post.title,
          description: res.post.intro,
          author: { '@type': 'Person', name: res.post.author.display_name },
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load thought experiment.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    lastSavedPctRef.current = 0;
    loadPost();
  }, [slug]);

  useEffect(() => {
    if (!currentUser || !post) return;
    let timer: number | null = null;
    const handleScroll = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const doc = document.documentElement;
        const maxScroll = Math.max(1, doc.scrollHeight - window.innerHeight);
        const pct = Math.min(100, Math.max(5, Math.round((window.scrollY / maxScroll) * 100)));
        if (pct <= lastSavedPctRef.current && lastSavedPctRef.current >= 15) return;
        lastSavedPctRef.current = pct;
        let lastSection = 'premise';
        const candidates = [
          { id: 'section-free', key: 'free' },
          { id: 'section-breaks-down', key: 'breaks_down' },
          { id: 'section-ripples', key: 'ripples' },
          { id: 'section-premise', key: 'premise' },
        ];
        for (const c of candidates) {
          const el = document.getElementById(c.id);
          if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.55) {
            lastSection = c.key;
            break;
          }
        }
        api.saveReadingProgress(post.id, { progress_pct: pct, last_section: lastSection }).catch(() => {});
      }, 600);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (timer) window.clearTimeout(timer);
    };
  }, [currentUser?.id, post?.id]);

  const speechText = useMemo(() => {
    if (!post) return '';
    return [post.title, post.intro, post.body_json.premise, post.body_json.ripples, post.body_json.breaks_down, post.body_json.free_content]
      .filter(Boolean)
      .join('. ');
  }, [post]);

  const handleResumeSection = (sectionKey: string) => {
    const normalized = sectionKey.replace(/^section-/, '').replace(/_/g, '-');
    const el = document.getElementById(`section-${normalized}`) || document.getElementById(`section-${sectionKey}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleReact = async (kind: ReactionKind) => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!post) return;
    try {
      const res = await api.toggleReaction({ target_type: 'post', target_id: post.id, kind });
      if (res.post) setPost(res.post);
      onUserRefresh();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Could not update reaction.', 'error');
    }
  };

  const handleBookmark = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!post) return;
    try {
      const res = await api.toggleBookmark(post.id);
      setPost({
        ...post,
        is_bookmarked: res.bookmarked,
        counts: { ...post.counts, bookmarks: res.bookmarks_count },
      });
      pushToast(res.bookmarked ? 'Saved to bookmarks.' : 'Removed from bookmarks.', 'info');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to update bookmark.', 'error');
    }
  };

  const handleFollow = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!post) return;
    try {
      const res = await api.toggleFollow(post.author_id);
      setPost({ ...post, is_following_author: res.following });
      pushToast(res.following ? `Following ${post.author.display_name}` : `Unfollowed ${post.author.display_name}`, 'info');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to update follow status.', 'error');
    }
  };

  const handleShare = () => {
    if (!post) return;
    setShareOpen(true);
  };

  const handleMindChangeSave = async (phase: 'before' | 'after') => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!post) return;
    setSavingMeter(true);
    try {
      const score = phase === 'before' ? beforeScore : afterScore;
      const res = await api.submitMindChange(post.id, phase, score);
      setPost({ ...post, mind_change: res.mind_change });
      pushToast(`Recorded your ${phase}-reading plausibility rating (${score}%).`, 'success');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to save rating.', 'error');
    } finally {
      setSavingMeter(false);
    }
  };

  const handleDelete = async () => {
    if (!post) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deletePost(post.id);
      pushToast('Thought experiment deleted.', 'info');
      onNavigate({ name: 'explore' });
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Delete failed.', 'error');
      setConfirmDelete(false);
    }
  };

  if (loading) return <DetailSkeleton />;

  if (error || !post) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">Entry Unavailable</h1>
        <p className="mt-3 text-slate-400">{error || 'This thought experiment could not be found.'}</p>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'explore' })}
          className="mt-6 rounded-lg bg-[#22D3EE] px-5 py-2.5 text-sm font-semibold text-slate-950"
        >
          Back to Explore
        </button>
      </div>
    );
  }

  const isAuthor = currentUser?.id === post.author_id;
  const canEdit = isAuthor || currentUser?.role === 'admin';
  const primaryCat = post.categories[0];

  return (
    <div>
      <NeuronProgressBar accentColor={primaryCat?.color || '#22D3EE'} />

      <article className="mx-auto max-w-3xl px-6 py-10 sm:py-14">
        {/* Category + Metadata Line */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          {post.categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => onNavigate({ name: 'explore', category: cat.slug })}
              style={{ color: cat.color }}
              className="font-semibold hover:underline"
            >
              {cat.name} ({cat.brain_region})
            </button>
          ))}
          <span aria-hidden="true">·</span>
          <span>{post.perspective}</span>
          <span aria-hidden="true">·</span>
          <span>{post.thinking_style}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{post.reading_minutes} min read</span>
        </div>

        <h1 className="mt-4 font-display text-3xl sm:text-5xl font-semibold tracking-tight text-white leading-[1.12]">
          {post.title}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-300">{post.intro}</p>

        {post.forked_from_post && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#A78BFA]/35 bg-[#131D33] px-3 py-1.5 text-xs text-slate-300">
            <GitFork className="h-3.5 w-3.5 text-[#A78BFA]" />
            <span>Branched from:</span>
            <button
              type="button"
              onClick={() => onNavigate({ name: 'post', slug: post.forked_from_post!.slug })}
              className="font-semibold text-[#A78BFA] hover:underline"
            >
              {post.forked_from_post.title}
            </button>
          </div>
        )}

        {/* Author & Actions Bar */}
        <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-y border-slate-800 py-4">
          <div className="flex items-center gap-3">
            <div>
              <button
                type="button"
                onClick={() => onNavigate({ name: 'profile', username: post.author.username })}
                className="text-sm font-semibold text-white hover:text-[#22D3EE] hover:underline"
              >
                {post.author.display_name}
              </button>
              <p className="font-mono text-xs text-slate-400">
                @{post.author.username} · {post.author.synapse_total} Synapse
              </p>
            </div>
            {!isAuthor && (
              <button
                type="button"
                onClick={handleFollow}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  post.is_following_author
                    ? 'border-[#22D3EE] bg-[#22D3EE]/15 text-[#22D3EE]'
                    : 'border-slate-700 bg-[#0E1525] text-slate-200 hover:border-slate-500'
                }`}
              >
                {post.is_following_author ? 'Following' : 'Follow'}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={handleBookmark}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium ${
                post.is_bookmarked
                  ? 'border-amber-400/50 bg-amber-500/15 text-amber-300'
                  : 'border-slate-700 bg-[#0E1525] text-slate-300 hover:border-slate-500'
              }`}
            >
              <Bookmark className="h-3.5 w-3.5" fill={post.is_bookmarked ? 'currentColor' : 'none'} />
              Save
            </button>
            <AddToCollectionMenu postId={post.id} currentUser={currentUser} onOpenAuth={onOpenAuth} />
            <button
              type="button"
              onClick={() => onNavigate({ name: 'write', forkId: post.id })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0E1525] px-3 py-1.5 font-medium text-slate-200 hover:border-[#A78BFA]"
            >
              <GitFork className="h-3.5 w-3.5 text-[#A78BFA]" />
              Branch
            </button>
            <button
              type="button"
              onClick={handleShare}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0E1525] px-3 py-1.5 font-medium text-slate-200 hover:border-[#22D3EE]"
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </button>
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'write', editId: post.id })}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0E1525] px-3 py-1.5 font-medium text-[#22D3EE] hover:border-[#22D3EE]"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 font-medium ${
                    confirmDelete
                      ? 'border-rose-500 bg-rose-600 text-white'
                      : 'border-rose-500/40 bg-rose-950/30 text-rose-300 hover:bg-rose-950/60'
                  }`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {confirmDelete ? 'Confirm Delete' : 'Delete'}
                </button>
                {confirmDelete && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300"
                  >
                    Cancel
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => onReport({ type: 'post', id: post.id, label: post.title })}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-800 px-2.5 py-1.5 text-slate-400 hover:text-rose-400"
            >
              <Flag className="h-3.5 w-3.5" />
              Report
            </button>
          </div>
        </div>

        <div className="mt-6">
          <ReadingControls
            textSize={textSize}
            onChangeTextSize={setTextSize}
            focusMode={focusMode}
            onToggleFocusMode={onToggleFocusMode}
            speechText={speechText}
            resumeProgress={post.reading_progress}
            onResumeSection={handleResumeSection}
          />
        </div>

        {/* Optional Cover Image */}
        {!focusMode && post.cover_url && (
          <div className="mt-8 overflow-hidden rounded-2xl border border-slate-800 bg-[#0E1525]">
            <img
              src={post.cover_url}
              alt={post.title}
              referrerPolicy="no-referrer"
              onError={(e) => {
                const img = e.currentTarget;
                if (!img.dataset.fallback) {
                  img.dataset.fallback = '1';
                  img.src = `/api/covers/${post.slug}.svg`;
                }
              }}
              className="aspect-[16/9] w-full object-cover"
            />
          </div>
        )}

        {/* Mind-Change Meter: Before Reading */}
        {!focusMode && (
          <section className="mt-8 rounded-xl border border-slate-800 bg-[#0E1525] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">Mind-Change Meter (Before Reading)</h2>
                <p className="text-xs text-slate-400">
                  How plausible does this premise feel before examining the ripples?
                </p>
              </div>
              {post.mind_change && post.mind_change.vote_count > 0 && (
                <span className="font-mono text-xs text-[#22D3EE] tabular-nums">
                  Avg shift: {post.mind_change.before_avg ?? '—'}% → {post.mind_change.after_avg ?? '—'}% (
                  {post.mind_change.delta_avg !== null
                    ? `${post.mind_change.delta_avg >= 0 ? '+' : ''}${post.mind_change.delta_avg}`
                    : '0'}
                  pts · {post.mind_change.vote_count} readers)
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <input
                type="range"
                min={0}
                max={100}
                value={beforeScore}
                onChange={(e) => setBeforeScore(Number(e.target.value))}
                aria-label="Plausibility before reading"
                className="flex-1 accent-[#22D3EE]"
              />
              <span className="font-mono text-sm font-semibold text-white tabular-nums w-12 text-right">
                {beforeScore}%
              </span>
              <button
                type="button"
                disabled={savingMeter}
                onClick={() => handleMindChangeSave('before')}
                className="rounded-lg border border-slate-700 bg-[#131D33] px-3 py-1.5 text-xs font-semibold text-slate-100 hover:border-[#22D3EE]"
              >
                Lock Prior
              </button>
            </div>
          </section>
        )}

        {/* Calm Editorial Structured Content */}
        <div className="mt-10 space-y-10 max-w-[68ch]">
          <section id="section-premise">
            <h2 className="font-mono text-xs uppercase tracking-wider text-[#22D3EE] mb-3">Premise</h2>
            <div className={readerProseClass(textSize)} dangerouslySetInnerHTML={{ __html: sanitizeRichText(post.body_json.premise) }} />
          </section>

          {post.body_json.ripples && (
            <section id="section-ripples" className="border-t border-slate-800/80 pt-8">
              <h2 className="font-mono text-xs uppercase tracking-wider text-[#A78BFA] mb-3">Ripple Effects</h2>
              <div className={readerProseClass(textSize)} dangerouslySetInnerHTML={{ __html: sanitizeRichText(post.body_json.ripples) }} />
            </section>
          )}

          {post.body_json.breaks_down && (
            <section id="section-breaks-down" className="border-t border-slate-800/80 pt-8">
              <h2 className="font-mono text-xs uppercase tracking-wider text-amber-400 mb-3">
                Where This Breaks Down
              </h2>
              <div className={readerProseClass(textSize)} dangerouslySetInnerHTML={{ __html: sanitizeRichText(post.body_json.breaks_down) }} />
            </section>
          )}

          {post.body_json.free_content && (
            <section id="section-free" className="border-t border-slate-800/80 pt-8">
              <h2 className="font-mono text-xs uppercase tracking-wider text-slate-400 mb-3">Synthesis &amp; Notes</h2>
              <div className={readerProseClass(textSize)} dangerouslySetInnerHTML={{ __html: sanitizeRichText(post.body_json.free_content) }} />
            </section>
          )}
        </div>

        {/* Tags & AI Disclosure */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-5 text-xs text-slate-400">
          <div className="flex flex-wrap gap-2">
            {(post.body_json.tags || []).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onNavigate({ name: 'search', q: tag })}
                className="font-mono text-slate-400 hover:text-[#22D3EE]"
              >
                #{tag}
              </button>
            ))}
          </div>
          <span className="font-mono text-slate-400">
            AI Disclosure:{' '}
            {post.ai_assisted ? post.ai_disclosure || 'AI assisted' : 'Written without AI drafting'}
          </span>
        </div>

        {/* Mind-Change Meter: After Reading */}
        {!focusMode && (
          <>
            <section className="mt-8 rounded-xl border border-[#A78BFA]/30 bg-[#131D33] p-5">
              <h2 className="font-display text-lg font-semibold text-white">Mind-Change Meter (After Reading)</h2>
              <p className="text-xs text-slate-300">
                Now that you&apos;ve traced the ripple effects, where does plausibility land?
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={afterScore}
                  onChange={(e) => setAfterScore(Number(e.target.value))}
                  aria-label="Plausibility after reading"
                  className="flex-1 accent-[#A78BFA]"
                />
                <span className="font-mono text-sm font-semibold text-white tabular-nums w-12 text-right">
                  {afterScore}%
                </span>
                <button
                  type="button"
                  disabled={savingMeter}
                  onClick={() => handleMindChangeSave('after')}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#A78BFA] px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-violet-300"
                >
                  Record Shift
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </section>

            {/* Insight Reactions */}
            <section className="mt-8 flex flex-wrap items-center gap-2.5">
              {REACTIONS.map((rxn) => {
                const Icon = rxn.icon;
                const active = post.user_reactions.includes(rxn.kind);
                const count = post.reaction_counts[rxn.kind] || 0;
                return (
                  <button
                    key={rxn.kind}
                    type="button"
                    disabled={isAuthor}
                    onClick={() => handleReact(rxn.kind)}
                    title={isAuthor ? 'You cannot react to your own post' : rxn.label}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-[#22D3EE] bg-[#22D3EE]/15 text-[#22D3EE]'
                        : 'border-slate-700 bg-[#0E1525] text-slate-200 hover:border-slate-500'
                    } disabled:opacity-50`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{rxn.label}</span>
                    <span className="font-mono tabular-nums text-slate-300">{count}</span>
                  </button>
                );
              })}
            </section>

            {/* Three-Lens Discussion */}
            <ThreeLensDiscussion
              postId={post.id}
              currentUser={currentUser}
              onOpenAuth={onOpenAuth}
              onBranchToPost={(branchBody) => onBranchWithPremise(post.id, branchBody)}
              onReportComment={(commentId, excerpt) => onReport({ type: 'comment', id: commentId, label: excerpt })}
              onCountsChanged={loadPost}
            />
          </>
        )}
      </article>

      <ShareCardModal open={shareOpen} post={post} onClose={() => setShareOpen(false)} />
    </div>
  );
}
