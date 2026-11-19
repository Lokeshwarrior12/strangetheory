import { useEffect, useRef, useState } from 'react';
import { Bell, Menu, Search, X } from 'lucide-react';
import { APP_NAME } from '../../lib/config';
import type { Profile } from '../../lib/types';

export type AppRoute =
  | { name: 'home' }
  | { name: 'explore'; category?: string; type?: string; view?: 'list' | 'graph' }
  | { name: 'search'; q?: string }
  | { name: 'daily' }
  | { name: 'riddles' }
  | { name: 'weekly-riddle' }
  | { name: 'leaderboard' }
  | { name: 'my-brain' }
  | { name: 'collections' }
  | { name: 'collection-detail'; slug: string }
  | { name: 'dashboard' }
  | { name: 'write'; editId?: string; initialType?: 'experiment' | 'riddle'; forkId?: string }
  | { name: 'drafts' }
  | { name: 'bookmarks' }
  | { name: 'notifications' }
  | { name: 'digest-unsubscribed'; status?: string }
  | { name: 'settings' }
  | { name: 'post'; slug: string }
  | { name: 'riddle'; slug: string }
  | { name: 'profile'; username: string }
  | { name: 'auth'; mode: 'signin' | 'signup' | 'reset-password' | 'verify-email'; token?: string }
  | { name: 'moderation' }
  | { name: 'admin' }
  | { name: 'legal'; doc: 'guidelines' | 'privacy' | 'terms' | 'about' }
  | { name: 'not-found' };

interface HeaderProps {
  currentUser: Profile | null;
  unreadDigestCount: number;
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
  onOpenDigest: () => void;
  onOpenCommandPalette: () => void;
  onLogout: () => void;
}

export function Header({
  currentUser,
  unreadDigestCount,
  activeRoute,
  onNavigate,
  onOpenAuth,
  onOpenDigest,
  onOpenCommandPalette,
  onLogout,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen && !mobileNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setMobileNavOpen(false);
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      if (menuOpen && menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [menuOpen, mobileNavOpen]);

  const navItems: Array<{ label: string; route: AppRoute; isActive: boolean }> = [
    { label: 'Explore', route: { name: 'explore' }, isActive: activeRoute.name === 'explore' || activeRoute.name === 'search' },
    { label: 'Daily Picks', route: { name: 'daily' }, isActive: activeRoute.name === 'daily' },
    {
      label: 'Riddles',
      route: { name: 'riddles' },
      isActive: activeRoute.name === 'riddles' || activeRoute.name === 'weekly-riddle',
    },
    { label: 'Leaderboard', route: { name: 'leaderboard' }, isActive: activeRoute.name === 'leaderboard' },
    { label: 'Write', route: { name: 'write' }, isActive: activeRoute.name === 'write' },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#070B14]/95">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 sm:gap-4 px-4 sm:px-6 py-3.5">
        {/* Zone 1: Single-line Brand Wordmark */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onNavigate({ name: 'home' });
            setMobileNavOpen(false);
            setMenuOpen(false);
          }}
          className="font-display text-lg sm:text-xl font-semibold tracking-tight text-slate-50 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#22D3EE]"
        >
          {APP_NAME}
        </a>

        {/* Zone 2: 5 concise single-line text nav links */}
        <nav aria-label="Primary" className="hidden md:flex items-center gap-6">
          {navItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => onNavigate(item.route)}
              className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 pb-0.5 border-b-2 ${
                item.isActive
                  ? 'border-[#22D3EE] text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-100 hover:border-slate-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Command Palette hint, Notifications Bell, Member Menu / Sign in */}
        <div className="relative flex items-center gap-1.5 sm:gap-2.5 min-w-0 shrink-0">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label="Open command palette (Ctrl+K)"
            className="hidden lg:inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0E1525] px-2.5 py-1.5 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200 whitespace-nowrap"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="font-mono text-[11px] text-slate-400">⌘K</span>
          </button>

          {currentUser && (
            <button
              type="button"
              data-testid="notifications-bell-button"
              onClick={onOpenDigest}
              aria-label={unreadDigestCount > 0 ? `Notifications (${unreadDigestCount} unread)` : 'Notifications'}
              className="relative rounded-lg border border-slate-700/80 bg-[#0E1525] p-2 text-slate-200 hover:border-[#22D3EE]/70 hover:text-white transition-colors shrink-0"
            >
              <Bell className="h-4 w-4" />
              {unreadDigestCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 font-mono text-[10px] font-bold text-slate-950 tabular-nums">
                  {unreadDigestCount > 9 ? '9+' : unreadDigestCount}
                </span>
              )}
            </button>
          )}

          {currentUser ? (
            <div ref={menuContainerRef} className="relative min-w-0">
              <button
                type="button"
                data-testid="member-menu-button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border border-slate-700/80 bg-[#0E1525] px-2.5 sm:px-3.5 py-2 text-xs font-semibold text-slate-100 hover:border-[#22D3EE]/70 transition-colors whitespace-nowrap shrink-0"
              >
                <span className="max-w-[72px] sm:max-w-[115px] truncate">{currentUser.display_name}</span>
                <span aria-hidden="true" className="text-slate-500">·</span>
                <span className="font-mono tabular-nums text-[#22D3EE]">{currentUser.synapse_total}</span>
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  aria-label="Member menu"
                  className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-700/80 bg-[#0E1525] py-1.5 shadow-2xl z-50"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate({ name: 'my-brain' });
                    }}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium text-[#22D3EE] hover:bg-[#131D33]"
                  >
                    <span>My Brain</span>
                    <span className="font-mono text-[11px] text-slate-400">3D Map</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate({ name: 'profile', username: currentUser.username });
                    }}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-slate-100 hover:bg-[#131D33]"
                  >
                    <span>Profile</span>
                    <span className="font-mono text-xs text-slate-400">@{currentUser.username}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate({ name: 'drafts' });
                    }}
                    className="flex w-full items-center px-4 py-2 text-left text-sm text-slate-200 hover:bg-[#131D33]"
                  >
                    Drafts
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate({ name: 'collections' });
                    }}
                    className="flex w-full items-center px-4 py-2 text-left text-sm text-slate-200 hover:bg-[#131D33]"
                  >
                    Collections
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate({ name: 'bookmarks' });
                    }}
                    className="flex w-full items-center px-4 py-2 text-left text-sm text-slate-200 hover:bg-[#131D33]"
                  >
                    Bookmarks
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate({ name: 'notifications' });
                    }}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-slate-200 hover:bg-[#131D33]"
                  >
                    <span>Notifications</span>
                    {unreadDigestCount > 0 && (
                      <span className="font-mono text-xs tabular-nums font-semibold text-amber-400">
                        {unreadDigestCount} new
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate({ name: 'dashboard' });
                    }}
                    className="flex w-full items-center px-4 py-2 text-left text-sm text-slate-200 hover:bg-[#131D33]"
                  >
                    Dashboard
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate({ name: 'settings' });
                    }}
                    className="flex w-full items-center px-4 py-2 text-left text-sm text-slate-200 hover:bg-[#131D33]"
                  >
                    Settings
                  </button>
                  {(currentUser.role === 'moderator' || currentUser.role === 'admin') && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onNavigate({ name: currentUser.role === 'admin' ? 'admin' : 'moderation' });
                      }}
                      className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-[#A78BFA] hover:bg-[#131D33]"
                    >
                      <span>{currentUser.role === 'admin' ? 'Admin & Moderation' : 'Moderation Queue'}</span>
                    </button>
                  )}
                  <div className="my-1 border-t border-slate-800" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                    className="flex w-full items-center px-4 py-2 text-left text-sm text-rose-400 hover:bg-rose-950/40"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 transition-colors whitespace-nowrap shrink-0"
            >
              Sign in
            </button>
          )}

          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileNavOpen}
            className="md:hidden rounded-lg border border-slate-700 p-2 text-slate-200 hover:border-slate-500"
          >
            {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {mobileNavOpen && (
        <nav aria-label="Mobile" className="md:hidden border-t border-slate-800 bg-[#0E1525] px-6 py-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {navItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  onNavigate(item.route);
                  setMobileNavOpen(false);
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
                  item.isActive ? 'bg-[#22D3EE] text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                onNavigate({ name: 'weekly-riddle' });
                setMobileNavOpen(false);
              }}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-[#A78BFA] hover:text-white"
            >
              Weekly Riddle
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                onOpenCommandPalette();
              }}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-white"
            >
              Search (⌘K)
            </button>
          </div>

          {currentUser && (
            <div className="border-t border-slate-800 pt-2.5 flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  onNavigate({ name: 'my-brain' });
                  setMobileNavOpen(false);
                }}
                className="rounded-md border border-[#22D3EE]/50 px-2.5 py-1.5 text-[#22D3EE]"
              >
                My Brain
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate({ name: 'profile', username: currentUser.username });
                  setMobileNavOpen(false);
                }}
                className="rounded-md border border-slate-700 px-2.5 py-1.5 text-slate-200"
              >
                Profile
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate({ name: 'drafts' });
                  setMobileNavOpen(false);
                }}
                className="rounded-md border border-slate-700 px-2.5 py-1.5 text-slate-200"
              >
                Drafts
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate({ name: 'collections' });
                  setMobileNavOpen(false);
                }}
                className="rounded-md border border-slate-700 px-2.5 py-1.5 text-slate-200"
              >
                Collections
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate({ name: 'bookmarks' });
                  setMobileNavOpen(false);
                }}
                className="rounded-md border border-slate-700 px-2.5 py-1.5 text-slate-200"
              >
                Bookmarks
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate({ name: 'notifications' });
                  setMobileNavOpen(false);
                }}
                className="rounded-md border border-slate-700 px-2.5 py-1.5 text-slate-200"
              >
                Notifications {unreadDigestCount > 0 ? `(${unreadDigestCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate({ name: 'dashboard' });
                  setMobileNavOpen(false);
                }}
                className="rounded-md border border-slate-700 px-2.5 py-1.5 text-slate-200"
              >
                Dashboard
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate({ name: 'settings' });
                  setMobileNavOpen(false);
                }}
                className="rounded-md border border-slate-700 px-2.5 py-1.5 text-slate-200"
              >
                Settings
              </button>
              {(currentUser.role === 'moderator' || currentUser.role === 'admin') && (
                <button
                  type="button"
                  onClick={() => {
                    onNavigate({ name: currentUser.role === 'admin' ? 'admin' : 'moderation' });
                    setMobileNavOpen(false);
                  }}
                  className="rounded-md border border-[#A78BFA]/40 px-2.5 py-1.5 text-[#A78BFA]"
                >
                  {currentUser.role === 'admin' ? 'Admin' : 'Moderation'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  onLogout();
                }}
                className="rounded-md border border-rose-500/40 px-2.5 py-1.5 text-rose-300"
              >
                Sign out
              </button>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
