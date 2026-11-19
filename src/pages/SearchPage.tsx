import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api, type CategoryWithCount } from '../lib/api';
import { PostCard } from '../components/ui/PostCard';
import { PostCardSkeleton } from '../components/ui/Skeleton';
import type { AppRoute } from '../components/nav/Header';
import type { EnrichedPost } from '../lib/types';

interface SearchPageProps {
  initialQuery?: string;
  categories: CategoryWithCount[];
  onNavigate: (route: AppRoute) => void;
  onOpenPost: (post: EnrichedPost) => void;
  onBookmark: (postId: string) => void;
}

export function SearchPage({
  initialQuery = '',
  categories,
  onNavigate,
  onOpenPost,
  onBookmark,
}: SearchPageProps) {
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const [typeFilter, setTypeFilter] = useState<'all' | 'experiment' | 'riddle'>('all');
  const [categorySlug, setCategorySlug] = useState('');
  const [sort, setSort] = useState<'relevance' | 'newest' | 'discussed'>('relevance');
  const [items, setItems] = useState<EnrichedPost[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setQuery(initialQuery);
    setSubmitted(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    if (!submitted.trim()) {
      setItems([]);
      return;
    }
    setLoading(true);
    api
      .searchPosts(submitted.trim(), { type: typeFilter, category: categorySlug, sort })
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [submitted, typeFilter, categorySlug, sort]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(query.trim());
    onNavigate({ name: 'search', q: query.trim() });
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl sm:text-4xl font-semibold text-white">Search the Archive</h1>
      <p className="mt-1.5 text-sm text-slate-400">
        Matches titles, intros, structured premises, ripple blocks, tags, and thinker names.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try 'gravity', 'qualia', 'Elena', 'Alexandria'..."
            className="w-full rounded-xl border border-slate-700 bg-[#0E1525] py-3 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
          />
        </div>
        <select
          aria-label="Filter by type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | 'experiment' | 'riddle')}
          className="rounded-xl border border-slate-700 bg-[#0E1525] px-3.5 py-3 text-sm text-slate-100"
        >
          <option value="all">All types</option>
          <option value="experiment">Thought Experiments</option>
          <option value="riddle">Riddles</option>
        </select>
        <select
          aria-label="Filter by brain region"
          value={categorySlug}
          onChange={(e) => setCategorySlug(e.target.value)}
          className="rounded-xl border border-slate-700 bg-[#0E1525] px-3.5 py-3 text-sm text-slate-100"
        >
          <option value="">All regions</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort results"
          value={sort}
          onChange={(e) => setSort(e.target.value as 'relevance' | 'newest' | 'discussed')}
          className="rounded-xl border border-slate-700 bg-[#0E1525] px-3.5 py-3 text-sm text-slate-100"
        >
          <option value="relevance">Relevance</option>
          <option value="newest">Newest</option>
          <option value="discussed">Most discussed</option>
        </select>
        <button
          type="submit"
          className="rounded-xl bg-[#22D3EE] px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
        >
          Search
        </button>
      </form>

      <div className="mt-8">
        {!submitted.trim() ? (
          <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-12 text-center text-sm text-slate-400">
            Enter a keyword, tag, or author name above to search all published entries.
          </div>
        ) : loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, idx) => (
              <PostCardSkeleton key={idx} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-[#0E1525] p-12 text-center">
            <p className="font-display text-xl font-semibold text-white">No matches for &ldquo;{submitted}&rdquo;</p>
            <p className="mt-2 text-sm text-slate-400">Try a broader keyword or clear region filters.</p>
          </div>
        ) : (
          <>
            <p className="mb-4 font-mono text-xs text-slate-400">
              {items.length} {items.length === 1 ? 'result' : 'results'} for &ldquo;{submitted}&rdquo;
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {items.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onOpenPost={onOpenPost}
                  onOpenAuthor={(username) => onNavigate({ name: 'profile', username })}
                  onBookmark={onBookmark}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
