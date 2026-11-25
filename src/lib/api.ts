import type {
  ApiErrorShape,
  AuthorDashboardEntry,
  Category,
  CollectionDetail,
  CollectionSummary,
  CommentLens,
  EnrichedComment,
  EnrichedPost,
  MindChangeSummary,
  MyBrainData,
  NotificationItem,
  Profile,
  ReactionKind,
  ReadingProgress,
  UserRole,
  WeeklyChallengeData,
} from './types';

export class ApiError extends Error {
  code: string;
  fields?: Array<{ field: string; message: string }>;
  status: number;

  constructor(status: number, body: ApiErrorShape) {
    super(body.message || 'Request failed');
    this.status = status;
    this.code = body.code || 'ERROR';
    this.fields = body.fields;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

let cachedCsrfToken: string | null = null;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const csrf = readCookie('st_csrf') || cachedCsrfToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(csrf ? { 'x-csrf-token': csrf } : {}),
    ...((options?.headers as Record<string, string>) || {}),
  };

  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data as ApiErrorShape);
  }
  return data as T;
}

export type ConditionalResponse<T> =
  | { notModified: true; etag: string | null }
  | { notModified: false; etag: string | null; data: T };

async function conditionalRequest<T>(url: string, ifNoneMatch?: string | null): Promise<ConditionalResponse<T>> {
  const headers: Record<string, string> = {};
  if (ifNoneMatch) {
    headers['If-None-Match'] = ifNoneMatch;
  }
  const res = await fetch(url, {
    credentials: 'include',
    headers,
  });
  const etag = res.headers.get('etag');
  if (res.status === 304) {
    return { notModified: true, etag: etag || ifNoneMatch || null };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data as ApiErrorShape);
  }
  return { notModified: false, etag, data: data as T };
}

export interface CategoryWithCount extends Category {
  post_count: number;
}

export interface DemoAccount {
  id: string;
  username: string;
  display_name: string;
  role: string;
  synapse_total: number;
}

export interface CommentRealtimeSnapshot {
  post_id: string;
  lens: CommentLens;
  total_top_level: number;
  total_count: number;
  new_top_level_count: number;
  new_count: number;
  latest_at: string | null;
}

export interface RiddleRealtimeSnapshot {
  post_id: string;
  revealed: boolean;
  accepted_comment_id: string | null;
  solver_count: number;
  solved_by_viewer: boolean;
  latest_solve_at: string | null;
}

export interface NotificationsRealtimeSnapshot {
  signed_in: boolean;
  unread_count: number;
  latest_at: string | null;
}

export interface LeaderboardLeader {
  rank: number;
  id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  role: string;
  synapse_total: number;
  all_time_synapse: number;
  badges: string[];
  posts_count: number;
  riddles_solved: number;
}

export interface LeaderboardSnapshot {
  window: 'week' | 'month' | 'all';
  leaders: LeaderboardLeader[];
}

export const api = {
  getMe: async () => {
    const res = await request<{
      user: Profile | null;
      csrf_token?: string;
      demo_accounts: DemoAccount[];
      google_enabled: boolean;
      contact_email?: string;
      app_url?: string;
    }>('/api/auth/me');
    if (res.csrf_token) cachedCsrfToken = res.csrf_token;
    return res;
  },
  signup: async (body: { email: string; username: string; display_name: string; password: string }) => {
    const res = await request<{ user: Profile; csrf_token?: string; verification_preview_url?: string }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res.csrf_token) cachedCsrfToken = res.csrf_token;
    return res;
  },
  login: async (body: { emailOrUsername: string; password: string }) => {
    const res = await request<{ user: Profile; csrf_token?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res.csrf_token) cachedCsrfToken = res.csrf_token;
    return res;
  },
  googleLogin: async (id_token: string) => {
    const res = await request<{ user: Profile; csrf_token?: string }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ id_token }),
    });
    if (res.csrf_token) cachedCsrfToken = res.csrf_token;
    return res;
  },
  demoSwitch: async (userId: string) => {
    const res = await request<{ user: Profile; csrf_token?: string }>('/api/auth/demo-switch', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
    if (res.csrf_token) cachedCsrfToken = res.csrf_token;
    return res;
  },
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  verifyEmail: (token: string) =>
    request<{ ok: boolean; user: Profile | null }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  resendVerification: () =>
    request<{ ok: boolean; message: string; preview_url?: string }>('/api/auth/resend-verification', { method: 'POST' }),
  resetPassword: (email: string) =>
    request<{ ok: boolean; message: string; preview_url?: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  confirmResetPassword: (token: string, password: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/reset-password/confirm', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  uploadImage: (dataUrl: string) =>
    request<{ url: string; sizeBytes: number }>('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ dataUrl }),
    }),

  getCategories: () => request<{ categories: CategoryWithCount[] }>('/api/categories'),
  getDaily: () =>
    request<{ daily_experiment: EnrichedPost | null; daily_riddle: EnrichedPost | null }>('/api/daily'),
  getRandom: () => request<{ post: EnrichedPost }>('/api/random'),
  getGraph: () =>
    request<{
      nodes: Array<{ id: string; kind: 'category' | 'experiment' | 'riddle'; label: string; slug: string; color: string; weight: number }>;
      edges: Array<{ source: string; target: string }>;
    }>('/api/graph'),

  getPosts: (params: {
    category?: string;
    type?: string;
    sort?: string;
    cursor?: number;
    limit?: number;
    authorId?: string;
    includeDrafts?: boolean;
  }) => {
    const sp = new URLSearchParams();
    if (params.category) sp.set('category', params.category);
    if (params.type) sp.set('type', params.type);
    if (params.sort) sp.set('sort', params.sort);
    if (params.cursor !== undefined) sp.set('cursor', String(params.cursor));
    if (params.limit !== undefined) sp.set('limit', String(params.limit));
    if (params.authorId) sp.set('authorId', params.authorId);
    if (params.includeDrafts) sp.set('includeDrafts', '1');
    return request<{ items: EnrichedPost[]; next_cursor: number | null; total: number }>(`/api/posts?${sp.toString()}`);
  },

  searchPosts: (q: string, opts?: { type?: string; category?: string; sort?: string }) => {
    const sp = new URLSearchParams({ q });
    if (opts?.type && opts.type !== 'all') sp.set('type', opts.type);
    if (opts?.category) sp.set('category', opts.category);
    if (opts?.sort) sp.set('sort', opts.sort);
    return request<{ items: EnrichedPost[]; total: number }>(`/api/search?${sp.toString()}`);
  },

  getForYouPosts: () =>
    request<{ items: EnrichedPost[]; personalized: boolean }>('/api/posts/for-you'),

  getPostBySlug: (slug: string) =>
    request<{ post: EnrichedPost }>(`/api/posts/by-slug/${encodeURIComponent(slug)}`),
  getPostById: (id: string) =>
    request<{ post: EnrichedPost }>(`/api/posts/${encodeURIComponent(id)}`),
  saveReadingProgress: (postId: string, body: { progress_pct: number; last_section?: string }) =>
    request<{ ok: boolean; reading_progress: ReadingProgress | null }>(`/api/posts/${encodeURIComponent(postId)}/progress`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createPost: (body: unknown) =>
    request<{ post: EnrichedPost }>('/api/posts', { method: 'POST', body: JSON.stringify(body) }),
  updatePost: (id: string, body: unknown) =>
    request<{ post: EnrichedPost }>(`/api/posts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  publishPost: (id: string) =>
    request<{ post: EnrichedPost }>(`/api/posts/${id}/publish`, { method: 'POST' }),
  deletePost: (id: string) =>
    request<{ ok: boolean }>(`/api/posts/${id}`, { method: 'DELETE' }),

  submitMindChange: (postId: string, phase: 'before' | 'after', score: number) =>
    request<{ mind_change: MindChangeSummary }>(`/api/posts/${postId}/mind-change`, {
      method: 'PUT',
      body: JSON.stringify({ phase, score }),
    }),

  getComments: (postId: string, lens: CommentLens, sort = 'top', cursor = 0, limit = 5) =>
    request<{ items: EnrichedComment[]; locked: boolean; total: number; next_cursor: number | null }>(
      `/api/posts/${postId}/comments?lens=${lens}&sort=${sort}&cursor=${cursor}&limit=${limit}`
    ),

  addComment: (postId: string, body: { lens: CommentLens; parent_id?: string | null; body: string }) =>
    request<{ comment: EnrichedComment; unlocked: boolean }>(`/api/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  revealHint: (postId: string) =>
    request<{ hints_used: number; revealed_hints: string[] }>(`/api/riddles/${postId}/hint`, { method: 'POST' }),
  showAnswers: (postId: string) =>
    request<{ answers_unlocked: boolean }>(`/api/riddles/${postId}/show-answers`, { method: 'POST' }),
  acceptAnswer: (postId: string, commentId: string) =>
    request<{ post: EnrichedPost }>(`/api/riddles/${postId}/accept/${commentId}`, { method: 'POST' }),
  revealExplanation: (postId: string) =>
    request<{ post: EnrichedPost }>(`/api/riddles/${postId}/reveal`, { method: 'POST' }),

  toggleReaction: (body: { target_type: 'post' | 'comment'; target_id: string; kind: ReactionKind }) =>
    request<{ active: boolean; post: EnrichedPost | null }>('/api/reactions', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  toggleFollow: (userId: string) =>
    request<{ following: boolean }>(`/api/follow/${userId}`, { method: 'POST' }),
  toggleBookmark: (postId: string) =>
    request<{ bookmarked: boolean; bookmarks_count: number }>(`/api/bookmarks/${postId}`, { method: 'POST' }),

  getProfile: (username: string) =>
    request<{
      profile: Profile;
      published: EnrichedPost[];
      drafts: EnrichedPost[];
      bookmarks: EnrichedPost[];
      followers_count: number;
      following_count: number;
      is_following: boolean;
      synapse_events: Array<{ id: string; reason: string; points: number; created_at: string }>;
    }>(`/api/users/${encodeURIComponent(username)}`),

  updateProfile: (body: {
    display_name?: string;
    bio?: string;
    interests?: string[];
    avatar_url?: string;
    daily_digest_enabled?: boolean;
    weekly_digest_enabled?: boolean;
    reading_goal_per_week?: number;
  }) => request<{ user: Profile }>('/api/users/me', { method: 'PATCH', body: JSON.stringify(body) }),
  searchUsers: (q: string) =>
    request<{ users: Array<{ id: string; username: string; display_name: string; avatar_url: string; synapse_total: number; role: UserRole }> }>(
      `/api/users/search?q=${encodeURIComponent(q)}`
    ),
  getMyBrain: () => request<MyBrainData & { signed_in: boolean }>('/api/my-brain'),
  submitOnboarding: (body: {
    favorite_category_ids: string[];
    reading_goal_per_week: number;
    weekly_digest_enabled?: boolean;
  }) => request<{ ok: boolean; user: Profile }>('/api/onboarding', { method: 'POST', body: JSON.stringify(body) }),
  updateEmail: (body: { email: string; current_password: string }) =>
    request<{ user: Profile; preview_url?: string }>('/api/users/me/email', { method: 'POST', body: JSON.stringify(body) }),
  updatePassword: (body: { current_password: string; new_password: string }) =>
    request<{ ok: boolean; message: string }>('/api/users/me/password', { method: 'POST', body: JSON.stringify(body) }),
  exportMyData: () => request<Record<string, unknown>>('/api/users/me/export'),
  deleteAccount: () => request<{ ok: boolean }>('/api/users/me', { method: 'DELETE' }),

  getLeaderboard: (window: 'week' | 'month' | 'all' = 'all') =>
    request<{
      window: 'week' | 'month' | 'all';
      leaders: Array<{
        rank: number;
        id: string;
        username: string;
        display_name: string;
        avatar_url: string;
        role: string;
        synapse_total: number;
        all_time_synapse: number;
        badges: string[];
        posts_count: number;
        riddles_solved: number;
      }>;
    }>(`/api/leaderboard?window=${window}`),

  getNotifications: () =>
    request<{
      items: NotificationItem[];
      unread_count: number;
      daily_digest_enabled: boolean;
      weekly_digest_enabled: boolean;
    }>('/api/notifications'),
  markNotificationsRead: () => request<{ ok: boolean }>('/api/notifications/read', { method: 'POST' }),

  getCollections: (opts?: { username?: string; postId?: string }) => {
    const sp = new URLSearchParams();
    if (opts?.username) sp.set('username', opts.username);
    if (opts?.postId) sp.set('postId', opts.postId);
    const qs = sp.toString();
    return request<{ collections: CollectionSummary[] }>(`/api/collections${qs ? `?${qs}` : ''}`);
  },
  getCollection: (idOrSlug: string) =>
    request<{ collection: CollectionDetail }>(`/api/collections/${encodeURIComponent(idOrSlug)}`),
  createCollection: (body: { title: string; note?: string; is_public?: boolean }) =>
    request<{ collection: CollectionSummary }>('/api/collections', { method: 'POST', body: JSON.stringify(body) }),
  updateCollection: (id: string, body: { title?: string; note?: string; is_public?: boolean }) =>
    request<{ collection: CollectionSummary }>(`/api/collections/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteCollection: (id: string) =>
    request<{ ok: boolean }>(`/api/collections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addToCollection: (collectionId: string, postId: string) =>
    request<{ ok: boolean; item_count: number }>(`/api/collections/${encodeURIComponent(collectionId)}/items`, {
      method: 'POST',
      body: JSON.stringify({ post_id: postId }),
    }),
  removeFromCollection: (collectionId: string, postId: string) =>
    request<{ ok: boolean; item_count: number }>(
      `/api/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(postId)}`,
      { method: 'DELETE' }
    ),

  getAuthorDashboard: () => request<{ entries: AuthorDashboardEntry[] }>('/api/dashboard'),
  getWeeklyChallenge: () => request<WeeklyChallengeData>('/api/weekly-riddle'),

  submitReport: (body: { target_type: 'post' | 'comment'; target_id: string; reason: string }) =>
    request<{ report: unknown }>('/api/reports', { method: 'POST', body: JSON.stringify(body) }),
  submitAppeal: (body: { target_type: 'post' | 'comment' | 'user'; target_id: string; reason: string }) =>
    request<{ appeal: unknown }>('/api/appeals', { method: 'POST', body: JSON.stringify(body) }),

  getModeration: () =>
    request<{
      reports: Array<{
        id: string;
        reporter_name: string;
        target_type: 'post' | 'comment';
        target_id: string;
        reason: string;
        status: string;
        target_excerpt: string;
        target_status: string;
        target_author_id: string | null;
        target_author_name: string;
        target_author_banned: boolean;
        created_at: string;
      }>;
      appeals: Array<{
        id: string;
        user_id: string;
        user_name: string;
        target_type: string;
        target_id: string;
        reason: string;
        status: string;
        reviewer_note: string | null;
        created_at: string;
      }>;
      mod_actions: Array<{
        id: string;
        moderator_name: string;
        target_type: string;
        target_id: string;
        action: string;
        note: string;
        created_at: string;
      }>;
      users: Profile[];
    }>('/api/admin/moderation'),

  runModerationAction: (body: {
    report_id?: string;
    appeal_id?: string;
    target_type: 'post' | 'comment' | 'user' | 'report';
    target_id: string;
    action: 'hide' | 'restore' | 'warn' | 'ban' | 'unban' | 'dismiss_report' | 'approve_appeal' | 'reject_appeal';
    note?: string;
  }) => request<{ ok: boolean }>('/api/admin/moderation/action', { method: 'POST', body: JSON.stringify(body) }),

  setUserRole: (userId: string, role: UserRole) =>
    request<{ ok: boolean; user: Profile }>(`/api/admin/users/${userId}/role`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),

  getAdminOverview: () =>
    request<{
      counts: { totalUsers: number; totalPosts: number; openReports: number; openAppeals: number };
      analytics: Array<{ event_name: string; count: number }>;
      error_logs: Array<{ id: number; source: string; message: string; route: string; created_at: string }>;
      outbox: Array<{ id: string; to_email: string; subject: string; provider: string; created_at: string }>;
    }>('/api/admin/overview'),

  trackEvent: (event_name: string, route: string, meta?: Record<string, unknown>) =>
    fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_name, route, meta }),
    }).catch(() => {}),

  reportClientError: (message: string, stack = '', route = '') =>
    fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, stack, route }),
    }).catch(() => {}),

  pollEntryComments: (postId: string, lens: CommentLens, since?: string | null, ifNoneMatch?: string | null) => {
    const sp = new URLSearchParams({ lens });
    if (since) sp.set('since', since);
    return conditionalRequest<CommentRealtimeSnapshot>(
      `/api/realtime/posts/${encodeURIComponent(postId)}/comments?${sp.toString()}`,
      ifNoneMatch
    );
  },

  pollRiddleStatus: (postId: string, ifNoneMatch?: string | null) =>
    conditionalRequest<RiddleRealtimeSnapshot>(
      `/api/realtime/riddles/${encodeURIComponent(postId)}`,
      ifNoneMatch
    ),

  pollNotifications: (ifNoneMatch?: string | null) =>
    conditionalRequest<NotificationsRealtimeSnapshot>('/api/realtime/notifications', ifNoneMatch),

  pollLeaderboard: (window: 'week' | 'month' | 'all' = 'all', ifNoneMatch?: string | null) =>
    conditionalRequest<LeaderboardSnapshot>(`/api/leaderboard?window=${window}`, ifNoneMatch),

  pollWeeklyChallenge: (ifNoneMatch?: string | null) =>
    conditionalRequest<WeeklyChallengeData>('/api/weekly-riddle', ifNoneMatch),
};
