import { Bookmark, MessageSquare, Lightbulb } from 'lucide-react';
import { TiltCard } from '../three/TiltCard';
import type { EnrichedPost } from '../../lib/types';

interface PostCardProps {
  post: EnrichedPost;
  onOpenPost: (post: EnrichedPost) => void;
  onOpenAuthor: (username: string) => void;
  onBookmark?: (postId: string) => void;
}

export function PostCard({ post, onOpenPost, onOpenAuthor, onBookmark }: PostCardProps) {
  const primaryCat = post.categories[0];
  const isRiddle = post.type === 'riddle';
  const accent = primaryCat?.color || '#22D3EE';
  const coverSrc = post.cover_url || `/api/covers/${post.slug}.svg`;

  return (
    <TiltCard glowColor={accent} className="h-full">
      <article className="group relative flex h-full flex-col justify-between rounded-xl border border-slate-800/80 bg-[#0E1525] p-6 transition-colors hover:border-slate-600/80">
        <div>
          <div className="mb-4 aspect-[16/10] w-full overflow-hidden rounded-lg border border-slate-800/80 bg-[#070B14]">
            <img
              src={coverSrc}
              alt={post.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const img = e.currentTarget;
                if (!img.dataset.fallback) {
                  img.dataset.fallback = '1';
                  img.src = `/api/covers/${post.slug}.svg`;
                }
              }}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">
              {isRiddle ? 'Riddle' : 'Thought Experiment'}
            </span>
            {primaryCat && (
              <>
                <span aria-hidden="true">·</span>
                <span style={{ color: primaryCat.color }} className="font-medium">
                  {primaryCat.name}
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            {isRiddle && post.riddle ? (
              <span>
                {post.riddle.difficulty} / {post.riddle.riddle_type}
              </span>
            ) : (
              <span className="tabular-nums">{post.reading_minutes} min read</span>
            )}
          </div>

          <h3 className="font-display text-xl font-semibold leading-snug text-slate-50">
            <button
              type="button"
              onClick={() => onOpenPost(post)}
              className="text-left hover:text-[#22D3EE] transition-colors focus-visible:outline-2 focus-visible:outline-[#22D3EE]"
            >
              {post.title}
            </button>
          </h3>

          <p className="mt-2.5 text-sm leading-relaxed text-slate-400 line-clamp-3">
            {post.intro}
          </p>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-slate-800/80 pt-4 text-xs text-slate-400">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => onOpenAuthor(post.author.username)}
              className="font-medium text-slate-200 hover:text-[#22D3EE] hover:underline truncate"
            >
              {post.author.display_name}
            </button>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-400">{post.author.synapse_total} Synapse</span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="inline-flex items-center gap-1 tabular-nums" title="Insights">
              <Lightbulb className="h-3.5 w-3.5 text-[#A78BFA]" />
              {post.counts.insights}
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums" title="Discussion notes">
              <MessageSquare className="h-3.5 w-3.5 text-[#22D3EE]" />
              {post.counts.comments}
            </span>
            {onBookmark && (
              <button
                type="button"
                onClick={() => onBookmark(post.id)}
                aria-label={post.is_bookmarked ? `Remove bookmark from ${post.title}` : `Bookmark ${post.title}`}
                aria-pressed={post.is_bookmarked}
                className={`p-1 rounded transition-colors ${
                  post.is_bookmarked ? 'text-amber-400' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <Bookmark className="h-3.5 w-3.5" fill={post.is_bookmarked ? 'currentColor' : 'none'} />
              </button>
            )}
          </div>
        </div>
      </article>
    </TiltCard>
  );
}
