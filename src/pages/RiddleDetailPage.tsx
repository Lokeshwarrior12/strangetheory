import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Flag, Share2, Edit3, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { sanitizeRichText } from '../lib/sanitize';
import { applySeo } from '../lib/seo';
import { RiddlePlayPanel } from '../components/riddle/RiddlePlayPanel';
import { NeuronProgressBar } from '../components/ui/NeuronProgressBar';
import { DetailSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/ToastContext';
import { ReadingControls, readerProseClass, useReaderSizePreference } from '../components/reader/ReadingControls';
import { ShareCardModal } from '../components/share/ShareCardModal';
import { AddToCollectionMenu } from '../components/collections/AddToCollectionMenu';
import type { AppRoute } from '../components/nav/Header';
import type { EnrichedPost, Profile } from '../lib/types';

interface RiddleDetailPageProps {
  slug: string;
  currentUser: Profile | null;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
  onReport: (target: { type: 'post' | 'comment'; id: string; label: string }) => void;
  onUserRefresh: () => void;
}

export function RiddleDetailPage({
  slug,
  currentUser,
  focusMode,
  onToggleFocusMode,
  onNavigate,
  onOpenAuth,
  onReport,
  onUserRefresh,
}: RiddleDetailPageProps) {
  const { pushToast } = useToast();
  const [textSize, setTextSize] = useReaderSizePreference();
  const [post, setPost] = useState<EnrichedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const lastSavedPctRef = useRef(0);

  useEffect(() => {
    lastSavedPctRef.current = 0;
    setLoading(true);
    setError(null);
    api
      .getPostBySlug(slug)
      .then((res) => {
        setPost(res.post);
        applySeo({
          title: res.post.title,
          description: res.post.intro,
          ogImage: `/api/og/${res.post.slug}.svg`,
          canonicalPath: `/riddle/${res.post.slug}`,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'Quiz',
            name: res.post.title,
            description: res.post.intro,
          },
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to load riddle.'))
      .finally(() => setLoading(false));
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
        api.saveReadingProgress(post.id, { progress_pct: pct, last_section: 'premise' }).catch(() => {});
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
    return [post.title, post.intro, post.body_json.premise].filter(Boolean).join('. ');
  }, [post]);

  const handleResumeSection = (sectionKey: string) => {
    const el = document.getElementById(`section-${sectionKey}`) || document.getElementById('section-premise');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      pushToast(res.bookmarked ? 'Riddle bookmarked.' : 'Bookmark removed.', 'info');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to update bookmark.', 'error');
    }
  };

  const handleShare = () => {
    if (!post) return;
    setShareOpen(true);
  };

  const handleDelete = async () => {
    if (!post) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deletePost(post.id);
      pushToast('Riddle deleted.', 'info');
      onNavigate({ name: 'riddles' });
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Delete failed.', 'error');
      setConfirmDelete(false);
    }
  };

  if (loading) return <DetailSkeleton />;

  if (error || !post || !post.riddle) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">Riddle Unavailable</h1>
        <p className="mt-3 text-slate-400">{error || 'This riddle could not be found.'}</p>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'riddles' })}
          className="mt-6 rounded-lg bg-[#A78BFA] px-5 py-2.5 text-sm font-semibold text-slate-950"
        >
          Browse Riddles
        </button>
      </div>
    );
  }

  const canEdit = currentUser?.id === post.author_id || currentUser?.role === 'admin';
  const primaryCat = post.categories[0];

  return (
    <div>
      <NeuronProgressBar accentColor={primaryCat?.color || '#A78BFA'} />

      <article className="mx-auto max-w-3xl px-6 py-10 sm:py-14">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="font-mono font-semibold text-[#A78BFA]">
            {post.riddle.difficulty} · {post.riddle.riddle_type}
          </span>
          {primaryCat && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => onNavigate({ name: 'explore', category: primaryCat.slug })}
                style={{ color: primaryCat.color }}
                className="font-semibold hover:underline"
              >
                {primaryCat.name}
              </button>
            </>
          )}
        </div>

        <h1 className="mt-3 font-display text-3xl sm:text-4xl font-semibold text-white leading-tight">
          {post.title}
        </h1>
        <p className="mt-3 text-base text-slate-300">{post.intro}</p>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-y border-slate-800 py-4 text-xs">
          <div>
            <button
              type="button"
              onClick={() => onNavigate({ name: 'profile', username: post.author.username })}
              className="font-semibold text-white hover:text-[#22D3EE] hover:underline"
            >
              {post.author.display_name}
            </button>
            <span className="ml-2 font-mono text-slate-400">@{post.author.username}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleBookmark}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium ${
                post.is_bookmarked
                  ? 'border-amber-400/50 bg-amber-500/15 text-amber-300'
                  : 'border-slate-700 bg-[#0E1525] text-slate-200'
              }`}
            >
              <Bookmark className="h-3.5 w-3.5" fill={post.is_bookmarked ? 'currentColor' : 'none'} />
              Save
            </button>
            <AddToCollectionMenu postId={post.id} currentUser={currentUser} onOpenAuth={onOpenAuth} />
            <button
              type="button"
              onClick={handleShare}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0E1525] px-3 py-1.5 font-medium text-slate-200"
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </button>
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'write', editId: post.id })}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0E1525] px-3 py-1.5 font-medium text-[#22D3EE]"
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
                      : 'border-rose-500/40 bg-rose-950/30 text-rose-300'
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

        {!focusMode && post.cover_url && (
          <div className="mt-7 overflow-hidden rounded-2xl border border-slate-800 bg-[#0E1525]">
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

        <section id="section-premise" className="mt-8 rounded-2xl border border-slate-800 bg-[#0E1525] p-6 sm:p-8 max-w-[68ch]">
          <h2 className="font-mono text-xs uppercase tracking-wider text-[#A78BFA] mb-3">The Challenge</h2>
          <div className={readerProseClass(textSize)} dangerouslySetInnerHTML={{ __html: sanitizeRichText(post.body_json.premise) }} />
        </section>

        {!focusMode && (
          <RiddlePlayPanel
            post={post}
            currentUser={currentUser}
            onPostUpdated={setPost}
            onOpenAuth={onOpenAuth}
            onReportComment={(commentId, excerpt) => onReport({ type: 'comment', id: commentId, label: excerpt })}
            onUserRefresh={onUserRefresh}
          />
        )}
      </article>

      <ShareCardModal open={shareOpen} post={post} onClose={() => setShareOpen(false)} />
    </div>
  );
}
