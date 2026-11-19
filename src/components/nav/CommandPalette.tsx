import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Compass, FolderHeart, LayoutDashboard, Search, Shuffle, Sparkles, Trophy, User, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useMotionPreference } from '../ui/MotionContext';
import type { AppRoute } from './Header';
import type { EnrichedPost, Profile } from '../../lib/types';

interface CommandPaletteProps {
  open: boolean;
  currentUser: Profile | null;
  onClose: () => void;
  onNavigate: (route: AppRoute) => void;
  onRandomPick: () => Promise<void> | void;
}

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  sublabel?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  currentUser,
  onClose,
  onNavigate,
  onRandomPick,
}: CommandPaletteProps) {
  const { reducedMotion, toggleReducedMotion } = useMotionPreference();
  const [query, setQuery] = useState('');
  const [postResults, setPostResults] = useState<EnrichedPost[]>([]);
  const [userResults, setUserResults] = useState<Array<{ id: string; username: string; display_name: string; synapse_total: number }>>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setPostResults([]);
      setUserResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setPostResults([]);
      setUserResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const [pRes, uRes] = await Promise.all([api.searchPosts(q), api.searchUsers(q)]);
        if (cancelled) return;
        setPostResults(pRes.items.slice(0, 6));
        setUserResults(uRes.users.slice(0, 4));
      } catch {
        // ignore search errors
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const items: PaletteItem[] = useMemo(() => {
    const list: PaletteItem[] = [];
    for (const p of postResults) {
      list.push({
        id: `post-${p.id}`,
        group: p.type === 'riddle' ? 'Riddle' : 'Experiment',
        label: p.title,
        sublabel: `${p.categories[0]?.name || 'Observatory'} · @${p.author.username}`,
        run: () => {
          onClose();
          onNavigate(p.type === 'riddle' ? { name: 'riddle', slug: p.slug } : { name: 'post', slug: p.slug });
        },
      });
    }
    for (const u of userResults) {
      list.push({
        id: `user-${u.id}`,
        group: 'Thinker',
        label: u.display_name,
        sublabel: `@${u.username} · ${u.synapse_total} Syn`,
        run: () => {
          onClose();
          onNavigate({ name: 'profile', username: u.username });
        },
      });
    }

    const qLower = query.trim().toLowerCase();
    const pages: PaletteItem[] = [
      { id: 'pg-explore', group: 'Navigate', label: 'Explore Library', sublabel: 'Browse 10 brain regions', run: () => { onClose(); onNavigate({ name: 'explore' }); } },
      { id: 'pg-daily', group: 'Navigate', label: 'Daily Picks', sublabel: 'Experiment & riddle of the day', run: () => { onClose(); onNavigate({ name: 'daily' }); } },
      { id: 'pg-weekly', group: 'Navigate', label: 'Weekly Riddle Challenge', sublabel: 'Top-10 fewest hints & fastest', run: () => { onClose(); onNavigate({ name: 'weekly-riddle' }); } },
      { id: 'pg-riddles', group: 'Navigate', label: 'Lateral Riddles', sublabel: 'Spoiler-protected puzzles', run: () => { onClose(); onNavigate({ name: 'riddles' }); } },
      { id: 'pg-mybrain', group: 'Navigate', label: 'My Brain', sublabel: 'Personal 3D map, badges & streak', run: () => { onClose(); onNavigate({ name: 'my-brain' }); } },
      { id: 'pg-collections', group: 'Navigate', label: 'Collections', sublabel: 'Curated reading lists', run: () => { onClose(); onNavigate({ name: 'collections' }); } },
      { id: 'pg-dashboard', group: 'Navigate', label: 'Author Dashboard', sublabel: 'Views, mind-change & solve rates', run: () => { onClose(); onNavigate({ name: 'dashboard' }); } },
      { id: 'pg-leaderboard', group: 'Navigate', label: 'Synapse Leaderboard', sublabel: 'Top thinkers', run: () => { onClose(); onNavigate({ name: 'leaderboard' }); } },
      { id: 'pg-write', group: 'Navigate', label: 'Write a Theory or Riddle', sublabel: 'Open Structured Studio', run: () => { onClose(); onNavigate({ name: 'write' }); } },
      ...(currentUser
        ? [{ id: 'pg-profile', group: 'Navigate', label: 'My Profile', sublabel: `@${currentUser.username}`, run: () => { onClose(); onNavigate({ name: 'profile', username: currentUser.username }); } }]
        : []),
    ];

    const actions: PaletteItem[] = [
      {
        id: 'act-random',
        group: 'Action',
        label: 'Random Entry',
        sublabel: 'Jump to a surprise thought experiment or riddle',
        run: () => {
          onClose();
          onRandomPick();
        },
      },
      {
        id: 'act-motion',
        group: 'Action',
        label: reducedMotion ? 'Resume 3D Motion' : 'Toggle Motion (Pause 3D)',
        sublabel: reducedMotion ? 'Currently paused / reduced' : 'Currently active',
        run: () => {
          toggleReducedMotion();
          onClose();
        },
      },
    ];

    const staticCandidates = [...actions, ...pages];
    for (const c of staticCandidates) {
      if (!qLower || c.label.toLowerCase().includes(qLower) || (c.sublabel || '').toLowerCase().includes(qLower)) {
        list.push(c);
      }
    }
    return list;
  }, [postResults, userResults, query, currentUser, reducedMotion, onClose, onNavigate, onRandomPick, toggleReducedMotion]);

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length, query]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (items.length ? (prev + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (items.length ? (prev - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter' && items[activeIndex]) {
      e.preventDefault();
      items[activeIndex].run();
    }
  };

  const iconForGroup = (group: string, id: string) => {
    if (id === 'act-random') return <Shuffle className="h-4 w-4 text-[#22D3EE]" />;
    if (id === 'act-motion') return <Sparkles className="h-4 w-4 text-amber-300" />;
    if (group === 'Thinker') return <User className="h-4 w-4 text-[#22D3EE]" />;
    if (group === 'Riddle') return <Brain className="h-4 w-4 text-[#A78BFA]" />;
    if (id === 'pg-collections') return <FolderHeart className="h-4 w-4 text-[#22D3EE]" />;
    if (id === 'pg-dashboard') return <LayoutDashboard className="h-4 w-4 text-[#22D3EE]" />;
    if (id === 'pg-leaderboard' || id === 'pg-weekly') return <Trophy className="h-4 w-4 text-amber-300" />;
    return <Compass className="h-4 w-4 text-slate-400" />;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 px-4 pt-16 sm:pt-24"
    >
      <div
        onKeyDown={handleKeyDown}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-700 bg-[#0E1525] shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 text-[#22D3EE] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search entries & thinkers, jump to a page, or run an action..."
            aria-label="Command palette search"
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          {searching && <span className="font-mono text-[11px] text-slate-400">Searching...</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2" role="listbox">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No matching entries, thinkers, or commands.</p>
          ) : (
            items.map((item, idx) => {
              const selected = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={item.run}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    selected ? 'bg-[#131D33] text-white border border-[#22D3EE]/35' : 'text-slate-300 hover:bg-[#070B14] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {iconForGroup(item.group, item.id)}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{item.label}</p>
                      {item.sublabel && <p className="truncate text-xs text-slate-400">{item.sublabel}</p>}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400 shrink-0">{item.group}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 bg-[#070B14] px-4 py-2 font-mono text-[11px] text-slate-400">
          <span>↑↓ navigate · Enter open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
