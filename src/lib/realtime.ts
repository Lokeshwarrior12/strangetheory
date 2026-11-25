import {
  api,
  ApiError,
  type CommentRealtimeSnapshot,
  type ConditionalResponse,
  type LeaderboardSnapshot,
  type NotificationsRealtimeSnapshot,
  type RiddleRealtimeSnapshot,
} from './api';
import type { CommentLens, WeeklyChallengeData } from './types';

export interface RealtimeTransport {
  subscribeEntryComments: (opts: {
    postId: string;
    lens: CommentLens;
    getSince: () => string | null;
    onUpdate: (snapshot: CommentRealtimeSnapshot) => void;
  }) => () => void;
  subscribeRiddleStatus: (opts: {
    postId: string;
    onUpdate: (snapshot: RiddleRealtimeSnapshot) => void;
  }) => () => void;
  subscribeNotifications: (opts: {
    onUpdate: (snapshot: NotificationsRealtimeSnapshot) => void;
  }) => () => void;
  subscribeLeaderboard: (opts: {
    window: 'week' | 'month' | 'all';
    onUpdate: (snapshot: LeaderboardSnapshot) => void;
  }) => () => void;
  subscribeWeeklyChallenge: (opts: {
    onUpdate: (snapshot: WeeklyChallengeData) => void;
  }) => () => void;
}

function createAdaptivePoller<T>(opts: {
  baseIntervalMs: number;
  maxIntervalMs?: number;
  minFocusGapMs?: number;
  pollOnStart?: boolean;
  fetcher: (ifNoneMatch: string | null) => Promise<ConditionalResponse<T>>;
  onData: (data: T) => void;
}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  let disposed = false;
  let timerId: number | null = null;
  let inFlight = false;
  let etag: string | null = null;
  let unchangedStreak = 0;
  let lastAttemptAt = 0;
  const maxInterval = opts.maxIntervalMs ?? opts.baseIntervalMs * 3;
  const minFocusGap = opts.minFocusGapMs ?? 2500;

  const clearTimer = () => {
    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
  };

  const nextDelay = (rateLimited = false): number => {
    if (rateLimited) return Math.min(maxInterval * 2, opts.baseIntervalMs * 4);
    if (unchangedStreak <= 0) return opts.baseIntervalMs;
    if (unchangedStreak === 1) return Math.min(maxInterval, Math.round(opts.baseIntervalMs * 1.5));
    return Math.min(maxInterval, opts.baseIntervalMs * 2);
  };

  const scheduleNext = (delayMs: number) => {
    clearTimer();
    if (disposed || document.visibilityState === 'hidden') return;
    timerId = window.setTimeout(() => {
      void tick(false);
    }, delayMs);
  };

  const tick = async (fromResume: boolean) => {
    if (disposed || document.visibilityState === 'hidden') return;
    if (inFlight) return;
    const now = Date.now();
    if (fromResume && now - lastAttemptAt < minFocusGap) {
      scheduleNext(opts.baseIntervalMs);
      return;
    }
    inFlight = true;
    lastAttemptAt = now;
    let hitRateLimit = false;

    try {
      const result = await opts.fetcher(etag);
      if (disposed) return;
      if (result.etag) etag = result.etag;

      if (result.notModified) {
        unchangedStreak = Math.min(4, unchangedStreak + 1);
      } else if ('data' in result) {
        unchangedStreak = 0;
        opts.onData(result.data);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        hitRateLimit = true;
      }
      unchangedStreak = Math.min(4, unchangedStreak + 1);
    } finally {
      inFlight = false;
      if (!disposed) {
        scheduleNext(nextDelay(hitRateLimit));
      }
    }
  };

  const handleVisibilityOrFocus = () => {
    if (disposed) return;
    if (document.visibilityState === 'hidden') {
      clearTimer();
      return;
    }
    unchangedStreak = 0;
    void tick(true);
  };

  document.addEventListener('visibilitychange', handleVisibilityOrFocus);
  window.addEventListener('focus', handleVisibilityOrFocus);

  if (opts.pollOnStart) {
    void tick(false);
  } else {
    scheduleNext(opts.baseIntervalMs);
  }

  return () => {
    disposed = true;
    clearTimer();
    document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    window.removeEventListener('focus', handleVisibilityOrFocus);
  };
}

export class PollingRealtimeTransport implements RealtimeTransport {
  subscribeEntryComments(opts: {
    postId: string;
    lens: CommentLens;
    getSince: () => string | null;
    onUpdate: (snapshot: CommentRealtimeSnapshot) => void;
  }): () => void {
    return createAdaptivePoller({
      baseIntervalMs: 20_000,
      fetcher: (ifNoneMatch) => api.pollEntryComments(opts.postId, opts.lens, opts.getSince(), ifNoneMatch),
      onData: opts.onUpdate,
    });
  }

  subscribeRiddleStatus(opts: {
    postId: string;
    onUpdate: (snapshot: RiddleRealtimeSnapshot) => void;
  }): () => void {
    return createAdaptivePoller({
      baseIntervalMs: 30_000,
      pollOnStart: true,
      fetcher: (ifNoneMatch) => api.pollRiddleStatus(opts.postId, ifNoneMatch),
      onData: opts.onUpdate,
    });
  }

  subscribeNotifications(opts: {
    onUpdate: (snapshot: NotificationsRealtimeSnapshot) => void;
  }): () => void {
    return createAdaptivePoller({
      baseIntervalMs: 45_000,
      fetcher: (ifNoneMatch) => api.pollNotifications(ifNoneMatch),
      onData: opts.onUpdate,
    });
  }

  subscribeLeaderboard(opts: {
    window: 'week' | 'month' | 'all';
    onUpdate: (snapshot: LeaderboardSnapshot) => void;
  }): () => void {
    return createAdaptivePoller({
      baseIntervalMs: 60_000,
      fetcher: (ifNoneMatch) => api.pollLeaderboard(opts.window, ifNoneMatch),
      onData: opts.onUpdate,
    });
  }

  subscribeWeeklyChallenge(opts: {
    onUpdate: (snapshot: WeeklyChallengeData) => void;
  }): () => void {
    return createAdaptivePoller({
      baseIntervalMs: 60_000,
      fetcher: (ifNoneMatch) => api.pollWeeklyChallenge(ifNoneMatch),
      onData: opts.onUpdate,
    });
  }
}

export const realtime: RealtimeTransport = new PollingRealtimeTransport();
