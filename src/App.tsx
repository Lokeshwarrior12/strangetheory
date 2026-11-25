import { useEffect, useState } from 'react';
import { Header, type AppRoute } from './components/nav/Header';
import { CommandPalette } from './components/nav/CommandPalette';
import { AuthModal } from './components/auth/AuthModal';
import { OnboardingModal } from './components/onboarding/OnboardingModal';
import { DigestDrawer } from './components/digest/DigestDrawer';
import { ReportModal } from './components/moderation/ReportModal';
import { AppealModal } from './components/moderation/AppealModal';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { MotionProvider } from './components/ui/MotionContext';
import { OfflineIndicator } from './components/ui/OfflineIndicator';
import { ToastProvider, useToast } from './components/ui/ToastContext';
import { StructuredEditor } from './components/editor/StructuredEditor';
import { HomePage } from './pages/HomePage';
import { ExplorePage } from './pages/ExplorePage';
import { SearchPage } from './pages/SearchPage';
import { DailyPage } from './pages/DailyPage';
import { PostDetailPage } from './pages/PostDetailPage';
import { RiddleDetailPage } from './pages/RiddleDetailPage';
import { ProfilePage } from './pages/ProfilePage';
import { DraftsPage } from './pages/DraftsPage';
import { BookmarksPage } from './pages/BookmarksPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuthPage } from './pages/AuthPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { MyBrainPage } from './pages/MyBrainPage';
import { CollectionsPage } from './pages/CollectionsPage';
import { CollectionDetailPage } from './pages/CollectionDetailPage';
import { DashboardPage } from './pages/DashboardPage';
import { WeeklyChallengePage } from './pages/WeeklyChallengePage';
import { DigestUnsubscribedPage } from './pages/DigestUnsubscribedPage';
import { AdminPage } from './pages/AdminPage';
import { LegalPage } from './pages/LegalPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { api, type CategoryWithCount, type DemoAccount } from './lib/api';
import { APP_NAME, APP_TAGLINE, DEFAULT_CONTACT_EMAIL, FOCUS_LIMITS } from './lib/config';
import { realtime } from './lib/realtime';
import { applySeo, setConfiguredAppUrl } from './lib/seo';
import type { EnrichedPost, NotificationItem, Profile } from './lib/types';

function parseRouteFromLocation(): AppRoute {
  // Backwards compatibility with hash URLs
  const hashRaw = window.location.hash.replace(/^#/, '');
  const fullRaw = hashRaw || `${window.location.pathname}${window.location.search}`;
  const [pathPartRaw, queryPart] = fullRaw.split('?');
  const pathPart = pathPartRaw === '/' ? '/' : pathPartRaw.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(queryPart || '');

  if (pathPart === '/') return { name: 'home' };
  if (pathPart === '/explore') {
    return {
      name: 'explore',
      category: params.get('category') || undefined,
      type: params.get('type') || 'all',
      view: params.get('view') === 'graph' ? 'graph' : 'list',
    };
  }
  if (pathPart === '/search') return { name: 'search', q: params.get('q') || '' };
  if (pathPart === '/daily') return { name: 'daily' };
  if (pathPart === '/riddles') return { name: 'riddles' };
  if (pathPart === '/weekly-riddle') return { name: 'weekly-riddle' };
  if (pathPart === '/leaderboard') return { name: 'leaderboard' };
  if (pathPart === '/my-brain') return { name: 'my-brain' };
  if (pathPart === '/collections') return { name: 'collections' };
  if (pathPart.startsWith('/collection/')) return { name: 'collection-detail', slug: pathPart.slice(12) };
  if (pathPart === '/dashboard') return { name: 'dashboard' };
  if (pathPart === '/write') {
    return {
      name: 'write',
      initialType: params.get('type') === 'riddle' ? 'riddle' : 'experiment',
      forkId: params.get('fork') || undefined,
    };
  }
  if (pathPart.startsWith('/write/')) return { name: 'write', editId: pathPart.slice(7) };
  if (pathPart === '/drafts') return { name: 'drafts' };
  if (pathPart === '/bookmarks') return { name: 'bookmarks' };
  if (pathPart === '/notifications') return { name: 'notifications' };
  if (pathPart === '/digest/unsubscribed') return { name: 'digest-unsubscribed', status: params.get('status') || 'ok' };
  if (pathPart === '/settings') return { name: 'settings' };
  if (pathPart === '/signin') return { name: 'auth', mode: 'signin' };
  if (pathPart === '/signup') return { name: 'auth', mode: 'signup' };
  if (pathPart === '/reset-password') return { name: 'auth', mode: 'reset-password', token: params.get('token') || undefined };
  if (pathPart === '/verify-email') return { name: 'auth', mode: 'verify-email', token: params.get('token') || undefined };
  if (pathPart === '/moderation') return { name: 'moderation' };
  if (pathPart === '/admin') return { name: 'admin' };
  if (pathPart === '/guidelines') return { name: 'legal', doc: 'guidelines' };
  if (pathPart === '/privacy') return { name: 'legal', doc: 'privacy' };
  if (pathPart === '/terms') return { name: 'legal', doc: 'terms' };
  if (pathPart === '/about') return { name: 'legal', doc: 'about' };
  if (pathPart.startsWith('/post/')) return { name: 'post', slug: pathPart.slice(6) };
  if (pathPart.startsWith('/riddle/')) return { name: 'riddle', slug: pathPart.slice(8) };
  if (pathPart.startsWith('/u/')) return { name: 'profile', username: pathPart.slice(3) };
  return { name: 'not-found' };
}

function pathFromRoute(route: AppRoute): string {
  switch (route.name) {
    case 'home':
      return '/';
    case 'explore': {
      const sp = new URLSearchParams();
      if (route.category) sp.set('category', route.category);
      if (route.type && route.type !== 'all') sp.set('type', route.type);
      if (route.view === 'graph') sp.set('view', 'graph');
      const qs = sp.toString();
      return qs ? `/explore?${qs}` : '/explore';
    }
    case 'search':
      return route.q ? `/search?q=${encodeURIComponent(route.q)}` : '/search';
    case 'daily':
      return '/daily';
    case 'riddles':
      return '/riddles';
    case 'weekly-riddle':
      return '/weekly-riddle';
    case 'leaderboard':
      return '/leaderboard';
    case 'my-brain':
      return '/my-brain';
    case 'collections':
      return '/collections';
    case 'collection-detail':
      return `/collection/${route.slug}`;
    case 'dashboard':
      return '/dashboard';
    case 'write': {
      if (route.editId) return `/write/${route.editId}`;
      const sp = new URLSearchParams();
      if (route.initialType === 'riddle') sp.set('type', 'riddle');
      if (route.forkId) sp.set('fork', route.forkId);
      const qs = sp.toString();
      return qs ? `/write?${qs}` : '/write';
    }
    case 'drafts':
      return '/drafts';
    case 'bookmarks':
      return '/bookmarks';
    case 'notifications':
      return '/notifications';
    case 'digest-unsubscribed':
      return route.status && route.status !== 'ok' ? `/digest/unsubscribed?status=${encodeURIComponent(route.status)}` : '/digest/unsubscribed';
    case 'settings':
      return '/settings';
    case 'post':
      return `/post/${route.slug}`;
    case 'riddle':
      return `/riddle/${route.slug}`;
    case 'profile':
      return `/u/${route.username}`;
    case 'auth': {
      const base = `/${route.mode}`;
      return route.token ? `${base}?token=${encodeURIComponent(route.token)}` : base;
    }
    case 'moderation':
      return '/moderation';
    case 'admin':
      return '/admin';
    case 'legal':
      return `/${route.doc}`;
    case 'not-found':
      return '/404';
  }
}

function AppShell() {
  const { pushToast } = useToast();
  const [route, setRoute] = useState<AppRoute>(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('autostart=1') && window.location.pathname === '/') {
      return { name: 'explore' };
    }
    return parseRouteFromLocation();
  });
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [contactEmail, setContactEmail] = useState(DEFAULT_CONTACT_EMAIL);
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [dailyExperiment, setDailyExperiment] = useState<EnrichedPost | null>(null);
  const [dailyRiddle, setDailyRiddle] = useState<EnrichedPost | null>(null);
  const [forYouPosts, setForYouPosts] = useState<EnrichedPost[]>([]);
  const [forYouPersonalized, setForYouPersonalized] = useState(false);
  const [trendingPosts, setTrendingPosts] = useState<EnrichedPost[]>([]);
  const [recentPosts, setRecentPosts] = useState<EnrichedPost[]>([]);
  const [digestItems, setDigestItems] = useState<NotificationItem[]>([]);
  const [unreadDigest, setUnreadDigest] = useState(0);

  const [authOpen, setAuthOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: 'post' | 'comment'; id: string; label: string } | null>(null);
  const [appealTarget, setAppealTarget] = useState<{ type: 'post' | 'comment' | 'user'; id: string; label: string } | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<AppRoute | null>(null);
  const [branchSeed, setBranchSeed] = useState<{ forkId: string; text: string } | null>(null);

  const commitNavigation = (next: AppRoute) => {
    const nextUrl = pathFromRoute(next);
    if (window.location.pathname + window.location.search !== nextUrl) {
      window.history.pushState(null, '', nextUrl);
    }
    setFocusMode(false);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'auto' });
    api.trackEvent('page_view', nextUrl);
  };

  const navigate = (next: AppRoute) => {
    if (route.name === 'write' && editorDirty && next.name !== 'write') {
      setPendingNav(next);
      return;
    }
    commitNavigation(next);
  };

  useEffect(() => {
    const onPopState = () => {
      setFocusMode(false);
      setRoute(parseRouteFromLocation());
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    const titles: Record<AppRoute['name'], string> = {
      home: `${APP_NAME} — ${APP_TAGLINE}`,
      explore: 'Explore Library & Idea Graph',
      search: 'Search',
      daily: 'Daily Picks',
      riddles: 'Lateral Riddles',
      'weekly-riddle': 'Weekly Riddle Challenge',
      leaderboard: 'Synapse Leaderboard',
      'my-brain': 'My Brain',
      collections: 'Curated Collections',
      'collection-detail': 'Collection',
      dashboard: 'Author Dashboard',
      write: 'Structured Studio',
      drafts: 'My Drafts',
      bookmarks: 'Bookmarks',
      notifications: 'Notifications',
      'digest-unsubscribed': 'Digest Preferences',
      settings: 'Settings',
      post: 'Thought Experiment',
      riddle: 'Riddle',
      profile: 'Thinker Profile',
      auth: 'Account Access',
      moderation: 'Moderation Queue',
      admin: 'Admin Console',
      legal: route.name === 'legal' ? route.doc.charAt(0).toUpperCase() + route.doc.slice(1) : 'Legal',
      'not-found': '404 Not Found',
    };
    if (route.name !== 'post' && route.name !== 'riddle') {
      applySeo({ title: titles[route.name] });
    }
  }, [route]);

  const refreshUserAndDigest = async () => {
    try {
      const me = await api.getMe();
      setCurrentUser(me.user);
      setDemoAccounts(me.demo_accounts);
      setGoogleEnabled(me.google_enabled);
      if (me.contact_email) setContactEmail(me.contact_email);
      if (me.app_url) setConfiguredAppUrl(me.app_url);
    } catch {
      // non-fatal
    }
    try {
      const dig = await api.getNotifications();
      setDigestItems(dig.items);
      setUnreadDigest(dig.unread_count);
    } catch {
      // non-fatal
    }
  };

  const refreshFeed = async () => {
    try {
      const [catRes, dailyRes, forYouRes, trendingRes, recentRes] = await Promise.all([
        api.getCategories(),
        api.getDaily(),
        api.getForYouPosts(),
        api.getPosts({ sort: 'trending', limit: FOCUS_LIMITS.HOME_TRENDING }),
        api.getPosts({ sort: 'newest', limit: FOCUS_LIMITS.HOME_TRENDING + FOCUS_LIMITS.HOME_RECENT }),
      ]);
      setCategories(catRes.categories);
      setDailyExperiment(dailyRes.daily_experiment);
      setDailyRiddle(dailyRes.daily_riddle);
      setForYouPosts(forYouRes.items);
      setForYouPersonalized(forYouRes.personalized);
      setTrendingPosts(trendingRes.items);
      setRecentPosts(recentRes.items);
    } catch {
      // non-fatal
    }
  };

  useEffect(() => {
    refreshUserAndDigest();
    refreshFeed();
  }, []);

  useEffect(() => {
    if (!currentUser?.id) return;
    let lastSig = `${unreadDigest}:${digestItems[0]?.created_at || ''}`;
    return realtime.subscribeNotifications({
      onUpdate: async (snap) => {
        if (!snap.signed_in) return;
        const nextSig = `${snap.unread_count}:${snap.latest_at || ''}`;
        if (nextSig !== lastSig) {
          lastSig = nextSig;
          setUnreadDigest(snap.unread_count);
          try {
            const dig = await api.getNotifications();
            setDigestItems(dig.items);
            setUnreadDigest(dig.unread_count);
          } catch {
            // non-fatal
          }
        }
      },
    });
  }, [currentUser?.id]);

  const handleOpenPost = (post: EnrichedPost) => {
    navigate(post.type === 'riddle' ? { name: 'riddle', slug: post.slug } : { name: 'post', slug: post.slug });
  };

  const handleOpenPostSlug = (slug: string, kind: 'experiment' | 'riddle') => {
    navigate(kind === 'riddle' ? { name: 'riddle', slug } : { name: 'post', slug });
  };

  const handleBookmark = async (postId: string) => {
    if (!currentUser) {
      setAuthOpen(true);
      return;
    }
    try {
      const res = await api.toggleBookmark(postId);
      pushToast(res.bookmarked ? 'Saved to bookmarks.' : 'Removed from bookmarks.', 'info');
      refreshFeed();
    } catch {
      pushToast('Unable to update bookmark.', 'error');
    }
  };

  const handleRandomPick = async () => {
    try {
      const res = await api.getRandom();
      handleOpenPost(res.post);
    } catch {
      pushToast('Unable to fetch a random entry right now.', 'error');
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      setCurrentUser(null);
      pushToast('Signed out.', 'info');
      refreshUserAndDigest();
      refreshFeed();
    }
  };

  const hideChrome = focusMode && (route.name === 'post' || route.name === 'riddle');
  const showOnboarding =
    !authOpen &&
    Boolean(currentUser && !currentUser.onboarding_completed && !onboardingDismissed) &&
    !window.location.search.includes('autostart=1') &&
    route.name !== 'digest-unsubscribed' &&
    !(route.name === 'auth' && (route.mode === 'verify-email' || route.mode === 'reset-password'));

  return (
    <ErrorBoundary onGoHome={() => commitNavigation({ name: 'home' })}>
      <div className="min-h-screen flex flex-col bg-[#070B14] text-[#F1F5F9]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-[#22D3EE] focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:text-slate-950 focus:shadow-lg"
        >
          Skip to main content
        </a>
        {!hideChrome && (
          <Header
            currentUser={currentUser}
            unreadDigestCount={unreadDigest}
            activeRoute={route}
            onNavigate={navigate}
            onOpenAuth={() => setAuthOpen(true)}
            onOpenDigest={() => setDigestOpen(true)}
            onOpenCommandPalette={() => setCommandOpen(true)}
            onLogout={handleLogout}
          />
        )}

        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          {route.name === 'home' && (
            <HomePage
              currentUser={currentUser}
              categories={categories}
              dailyExperiment={dailyExperiment}
              dailyRiddle={dailyRiddle}
              forYouPosts={forYouPosts}
              forYouPersonalized={forYouPersonalized}
              trendingPosts={trendingPosts}
              recentPosts={recentPosts}
              onNavigate={navigate}
              onOpenPost={handleOpenPost}
              onOpenPostSlug={handleOpenPostSlug}
              onBookmark={handleBookmark}
              onRandomPick={handleRandomPick}
            />
          )}

          {route.name === 'explore' && (
            <ExplorePage
              categories={categories}
              initialCategory={route.category}
              initialType={route.type}
              initialView={route.view}
              onNavigate={navigate}
              onOpenPost={handleOpenPost}
              onOpenPostSlug={handleOpenPostSlug}
              onBookmark={handleBookmark}
              onRandomPick={handleRandomPick}
            />
          )}

          {route.name === 'riddles' && (
            <ExplorePage
              categories={categories}
              initialType="riddle"
              onNavigate={navigate}
              onOpenPost={handleOpenPost}
              onOpenPostSlug={handleOpenPostSlug}
              onBookmark={handleBookmark}
              onRandomPick={handleRandomPick}
            />
          )}

          {route.name === 'search' && (
            <SearchPage
              initialQuery={route.q}
              categories={categories}
              onNavigate={navigate}
              onOpenPost={handleOpenPost}
              onBookmark={handleBookmark}
            />
          )}

          {route.name === 'daily' && (
            <DailyPage
              dailyExperiment={dailyExperiment}
              dailyRiddle={dailyRiddle}
              onNavigate={navigate}
              onOpenPost={handleOpenPost}
              onBookmark={handleBookmark}
              onRandomPick={handleRandomPick}
            />
          )}

          {route.name === 'write' && (
            <StructuredEditor
              currentUser={currentUser}
              editId={route.editId}
              initialType={route.initialType}
              forkId={route.forkId || branchSeed?.forkId}
              initialBranchPremise={branchSeed?.text}
              onOpenAuth={() => setAuthOpen(true)}
              onDirtyChange={setEditorDirty}
              onPublished={(post) => {
                setEditorDirty(false);
                setPendingNav(null);
                setBranchSeed(null);
                refreshFeed();
                refreshUserAndDigest();
                commitNavigation(post.type === 'riddle' ? { name: 'riddle', slug: post.slug } : { name: 'post', slug: post.slug });
              }}
              onDeleted={() => {
                setEditorDirty(false);
                refreshFeed();
                commitNavigation({ name: 'drafts' });
              }}
            />
          )}

          {route.name === 'drafts' && (
            <DraftsPage currentUser={currentUser} onNavigate={navigate} onOpenAuth={() => setAuthOpen(true)} />
          )}

          {route.name === 'bookmarks' && (
            <BookmarksPage
              currentUser={currentUser}
              onNavigate={navigate}
              onOpenPost={handleOpenPost}
              onOpenAuth={() => setAuthOpen(true)}
            />
          )}

          {route.name === 'notifications' && (
            <NotificationsPage
              currentUser={currentUser}
              onOpenAuth={() => setAuthOpen(true)}
              onNavigatePath={(href) => {
                window.history.pushState(null, '', href);
                setRoute(parseRouteFromLocation());
              }}
              onUserRefresh={refreshUserAndDigest}
            />
          )}

          {route.name === 'settings' && (
            <SettingsPage
              currentUser={currentUser}
              onOpenAuth={() => setAuthOpen(true)}
              onUserUpdated={(user) => {
                setCurrentUser(user);
                refreshUserAndDigest();
              }}
              onAccountDeleted={() => {
                setCurrentUser(null);
                refreshUserAndDigest();
                refreshFeed();
                commitNavigation({ name: 'home' });
              }}
            />
          )}

          {route.name === 'post' && (
            <PostDetailPage
              slug={route.slug}
              currentUser={currentUser}
              focusMode={focusMode}
              onToggleFocusMode={() => setFocusMode((v) => !v)}
              onNavigate={navigate}
              onOpenAuth={() => setAuthOpen(true)}
              onReport={(target) => setReportTarget(target)}
              onBranchWithPremise={(forkId, bodyText) => {
                setBranchSeed({ forkId, text: bodyText });
                navigate({ name: 'write', forkId });
              }}
              onUserRefresh={refreshUserAndDigest}
            />
          )}

          {route.name === 'riddle' && (
            <RiddleDetailPage
              slug={route.slug}
              currentUser={currentUser}
              focusMode={focusMode}
              onToggleFocusMode={() => setFocusMode((v) => !v)}
              onNavigate={navigate}
              onOpenAuth={() => setAuthOpen(true)}
              onReport={(target) => setReportTarget(target)}
              onUserRefresh={refreshUserAndDigest}
            />
          )}

          {route.name === 'my-brain' && (
            <MyBrainPage
              currentUser={currentUser}
              categories={categories}
              onNavigate={navigate}
              onOpenAuth={() => setAuthOpen(true)}
              onOpenPostSlug={handleOpenPostSlug}
            />
          )}

          {route.name === 'collections' && (
            <CollectionsPage
              currentUser={currentUser}
              onNavigate={navigate}
              onOpenAuth={() => setAuthOpen(true)}
            />
          )}

          {route.name === 'collection-detail' && (
            <CollectionDetailPage
              slug={route.slug}
              currentUser={currentUser}
              onNavigate={navigate}
              onOpenPost={handleOpenPost}
              onBookmark={handleBookmark}
            />
          )}

          {route.name === 'dashboard' && (
            <DashboardPage
              currentUser={currentUser}
              onNavigate={navigate}
              onOpenAuth={() => setAuthOpen(true)}
            />
          )}

          {route.name === 'weekly-riddle' && (
            <WeeklyChallengePage currentUser={currentUser} onNavigate={navigate} />
          )}

          {route.name === 'digest-unsubscribed' && (
            <DigestUnsubscribedPage status={route.status} onNavigate={navigate} />
          )}

          {route.name === 'profile' && (
            <ProfilePage
              username={route.username}
              currentUser={currentUser}
              onNavigate={navigate}
              onOpenPost={handleOpenPost}
              onOpenAuth={() => setAuthOpen(true)}
            />
          )}

          {route.name === 'auth' && (
            <AuthPage
              mode={route.mode}
              token={route.token}
              currentUser={currentUser}
              onSuccess={(user) => {
                setCurrentUser(user);
                refreshUserAndDigest();
                refreshFeed();
              }}
              onNavigate={navigate}
            />
          )}

          {route.name === 'leaderboard' && <LeaderboardPage onNavigate={navigate} />}

          {(route.name === 'moderation' || route.name === 'admin') && (
            <AdminPage
              currentUser={currentUser}
              mode={route.name}
              onOpenAuth={() => setAuthOpen(true)}
              onNavigate={navigate}
            />
          )}

          {route.name === 'legal' && <LegalPage doc={route.doc} contactEmail={contactEmail} onNavigate={navigate} />}

          {route.name === 'not-found' && <NotFoundPage onNavigate={navigate} />}
        </main>

        {!hideChrome && (
          <footer className="border-t border-slate-800/80 bg-[#070B14] py-8">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-xs text-slate-400">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-display text-sm font-semibold text-white">{APP_NAME}</span>
                <span aria-hidden="true">·</span>
                <span>{APP_TAGLINE}</span>
                <span aria-hidden="true">·</span>
                <a href={`mailto:${contactEmail}`} className="text-slate-300 hover:text-[#22D3EE] hover:underline">
                  {contactEmail}
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-5">
                <button type="button" onClick={() => navigate({ name: 'weekly-riddle' })} className="hover:text-white">
                  Weekly Challenge
                </button>
                <button type="button" onClick={() => navigate({ name: 'search' })} className="hover:text-white">
                  Search
                </button>
                <button type="button" onClick={() => navigate({ name: 'legal', doc: 'about' })} className="hover:text-white">
                  About
                </button>
                <button type="button" onClick={() => navigate({ name: 'legal', doc: 'guidelines' })} className="hover:text-white">
                  Community Guidelines
                </button>
                <button type="button" onClick={() => navigate({ name: 'legal', doc: 'privacy' })} className="hover:text-white">
                  Privacy
                </button>
                <button type="button" onClick={() => navigate({ name: 'legal', doc: 'terms' })} className="hover:text-white">
                  Terms
                </button>
                {currentUser && (
                  <button
                    type="button"
                    onClick={() =>
                      setAppealTarget({
                        type: 'user',
                        id: currentUser.id,
                        label: `Appeal for @${currentUser.username}`,
                      })
                    }
                    className="hover:text-[#A78BFA]"
                  >
                    Appeal Action
                  </button>
                )}
                {(currentUser?.role === 'moderator' || currentUser?.role === 'admin') && (
                  <button type="button" onClick={() => navigate({ name: 'moderation' })} className="hover:text-[#22D3EE]">
                    Moderation
                  </button>
                )}
              </div>
            </div>
          </footer>
        )}

        {/* Unsaved Editor Navigation Warning Modal */}
        {pendingNav && (
          <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-[#0E1525] p-6 shadow-2xl">
              <h2 className="font-display text-xl font-semibold text-white">Unsaved changes</h2>
              <p className="mt-2 text-sm text-slate-300">
                You have unsaved edits in the Studio. Leave without saving?
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingNav(null)}
                  className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200"
                >
                  Stay in Editor
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const dest = pendingNav;
                    setPendingNav(null);
                    setEditorDirty(false);
                    commitNavigation(dest);
                  }}
                  className="rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white"
                >
                  Leave Anyway
                </button>
              </div>
            </div>
          </div>
        )}

        <AuthModal
          open={authOpen}
          demoAccounts={demoAccounts}
          googleEnabled={googleEnabled}
          onClose={() => setAuthOpen(false)}
          onSuccess={(user) => {
            setCurrentUser(user);
            setOnboardingDismissed(false);
            refreshUserAndDigest();
            refreshFeed();
          }}
        />

        <OnboardingModal
          open={showOnboarding}
          categories={categories}
          onClose={() => setOnboardingDismissed(true)}
          onCompleted={(user) => {
            setCurrentUser(user);
            setOnboardingDismissed(true);
            refreshFeed();
          }}
        />

        <CommandPalette
          open={commandOpen}
          currentUser={currentUser}
          onClose={() => setCommandOpen(false)}
          onNavigate={navigate}
          onRandomPick={handleRandomPick}
        />

        <DigestDrawer
          open={digestOpen}
          items={digestItems}
          onClose={() => setDigestOpen(false)}
          onMarkRead={async () => {
            await api.markNotificationsRead();
            refreshUserAndDigest();
          }}
          onNavigateHref={(href) => {
            window.history.pushState(null, '', href);
            setFocusMode(false);
            setRoute(parseRouteFromLocation());
          }}
        />

        <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />
        <AppealModal target={appealTarget} onClose={() => setAppealTarget(null)} />
        <OfflineIndicator />
      </div>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <MotionProvider>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </MotionProvider>
  );
}
