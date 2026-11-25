import { CATEGORIES } from './categories.js';
import type { BrainBadge, RiddleDifficulty, SynapseEvent } from './types.js';

const FILLER_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'it',
  'are',
  'was',
  'were',
  'of',
  'to',
  'in',
  'on',
  'at',
  'for',
  'and',
  'or',
  'because',
  'my',
  'answer',
]);

/**
 * Reading time: words divided by 200, rounded up (minimum 1 min).
 */
export function calculateReadingTime(text: string): number {
  const cleaned = text.replace(/<[^>]*>/g, ' ').trim();
  if (!cleaned) return 1;
  const words = cleaned.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

/**
 * Riddle auto-match normalization:
 * lowercase, trim, remove punctuation and filler words.
 */
export function normalizeAnswer(input: string): string {
  const tokens = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !FILLER_WORDS.has(token));
  return tokens.join(' ');
}

/**
 * Compare normalized guess against author's keywords.
 * A match only flags the comment as 'likely_correct' for the author to confirm.
 */
export function isLikelyAnswerMatch(guess: string, keywords: string[]): boolean {
  const normalizedGuess = normalizeAnswer(guess);
  if (!normalizedGuess) return false;

  for (const rawKeyword of keywords) {
    const kw = normalizeAnswer(rawKeyword);
    if (!kw) continue;
    if (
      normalizedGuess === kw ||
      normalizedGuess.includes(kw) ||
      (normalizedGuess.length >= 3 && kw.includes(normalizedGuess))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Riddle solved points:
 * Easy +3, Medium +6, Hard +10 (minus 1 per hint used, never below 1),
 * plus +5 bonus for the first solver.
 */
export function calculateRiddleSolvePoints(
  difficulty: RiddleDifficulty,
  hintsUsed: number,
  isFirstSolver: boolean
): number {
  const baseByDifficulty: Record<RiddleDifficulty, number> = {
    Easy: 3,
    Medium: 6,
    Hard: 10,
  };
  const base = baseByDifficulty[difficulty];
  const clampedHints = Math.max(0, Math.min(3, Math.floor(hintsUsed)));
  const solvePoints = Math.max(1, base - clampedHints);
  return solvePoints + (isFirstSolver ? 5 : 0);
}

/**
 * Trending score:
 * (views * 0.2 + insights * 3 + comments * 2 + bookmarks * 2) / (ageHours + 2)^1.5
 */
export function calculateTrendingScore(metrics: {
  views: number;
  insights: number;
  comments: number;
  bookmarks: number;
  ageHours: number;
}): number {
  const numerator =
    metrics.views * 0.2 +
    metrics.insights * 3 +
    metrics.comments * 2 +
    metrics.bookmarks * 2;
  const denominator = Math.pow(Math.max(0, metrics.ageHours) + 2, 1.5);
  return Number((numerator / denominator).toFixed(4));
}

export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64);
  return base || 'untitled-theory';
}

export function calculateMindChangeStats(
  votes: Array<{ before_score: number | null; after_score: number | null }>
): { before_avg: number | null; after_avg: number | null; delta_avg: number | null; vote_count: number } {
  const beforeVals = votes.map((v) => v.before_score).filter((v): v is number => typeof v === 'number');
  const afterVals = votes.map((v) => v.after_score).filter((v): v is number => typeof v === 'number');
  const pairedDeltas = votes
    .filter((v) => typeof v.before_score === 'number' && typeof v.after_score === 'number')
    .map((v) => (v.after_score as number) - (v.before_score as number));

  const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  return {
    before_avg: avg(beforeVals),
    after_avg: avg(afterVals),
    delta_avg: pairedDeltas.length ? Number((pairedDeltas.reduce((a, b) => a + b, 0) / pairedDeltas.length).toFixed(1)) : null,
    vote_count: Math.max(beforeVals.length, afterVals.length),
  };
}

export function sumPointsInWindow(
  events: SynapseEvent[],
  window: 'week' | 'month' | 'all',
  nowMs = Date.now()
): Map<string, number> {
  const cutoff =
    window === 'week'
      ? nowMs - 7 * 86400_000
      : window === 'month'
        ? nowMs - 30 * 86400_000
        : 0;
  const totals = new Map<string, number>();
  for (const ev of events) {
    if (cutoff > 0 && new Date(ev.created_at).getTime() < cutoff) continue;
    totals.set(ev.user_id, (totals.get(ev.user_id) || 0) + ev.points);
  }
  return totals;
}

/**
 * Computes consecutive UTC days of reading/solving activity up to today (or yesterday).
 */
export function calculateCurrentStreakDays(activityDatesIso: string[], nowMs = Date.now()): number {
  const dayNums = new Set<number>();
  for (const iso of activityDatesIso) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    dayNums.add(Math.floor(ms / 86400_000));
  }
  if (dayNums.size === 0) return 0;

  const todayDay = Math.floor(nowMs / 86400_000);
  let cursor = dayNums.has(todayDay) ? todayDay : dayNums.has(todayDay - 1) ? todayDay - 1 : -1;
  if (cursor < 0) return 0;

  let streak = 0;
  while (dayNums.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

/**
 * Brain-region badges: 10 regional mastery badges (10 entries read/solved in a region)
 * plus 2 observatory milestone badges = 12 badges maximum.
 */
export function computeBrainBadges(metrics: {
  regionActivity: Record<string, number>;
  regionsExplored: number;
  riddlesSolved: number;
  streakDays: number;
}): BrainBadge[] {
  const regionBadges: BrainBadge[] = CATEGORIES.map((cat) => {
    const progress = metrics.regionActivity[cat.id] || 0;
    const target = 10;
    return {
      id: `badge-${cat.slug}`,
      name: `${cat.brain_region} Thinker`,
      description: `Explore 10 entries in ${cat.name} (${cat.brain_region}).`,
      category_slug: cat.slug,
      color: cat.color,
      earned: progress >= target,
      progress: Math.min(target, progress),
      target,
    };
  });

  const milestoneBadges: BrainBadge[] = [
    {
      id: 'badge-all-regions',
      name: 'Whole-Brain Cartographer',
      description: 'Read or solve at least one entry in all 10 brain regions.',
      category_slug: null,
      color: '#22D3EE',
      earned: metrics.regionsExplored >= CATEGORIES.length,
      progress: Math.min(CATEGORIES.length, metrics.regionsExplored),
      target: CATEGORIES.length,
    },
    {
      id: 'badge-weekly-synapse',
      name: 'Seven-Day Synapse',
      description: 'Maintain a 7-day reading or riddle-solving streak.',
      category_slug: null,
      color: '#F59E0B',
      earned: metrics.streakDays >= 7,
      progress: Math.min(7, metrics.streakDays),
      target: 7,
    },
  ];

  const all = [...regionBadges, ...milestoneBadges].slice(0, 12);
  // Earned badges first, then closest progress
  return all.sort((a, b) => Number(b.earned) - Number(a.earned) || b.progress / b.target - a.progress / a.target);
}

/**
 * Deterministic ISO-8601 UTC week key (e.g. "2026-W47") with Monday 00:00Z - Sunday 23:59Z bounds.
 */
export function getIsoWeekKey(date = new Date()): { weekKey: string; startsAt: string; endsAt: string } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1 .. Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400_000 + 1) / 7);
  const weekKey = `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;

  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (dayNum - 1));
  const sunday = new Date(monday.getTime() + 7 * 86400_000 - 1);

  return {
    weekKey,
    startsAt: monday.toISOString(),
    endsAt: sunday.toISOString(),
  };
}

export function rankWeeklyChallengeEntries<
  T extends { hints_used: number; duration_seconds: number; solved_at: string }
>(entries: T[]): Array<T & { rank: number }> {
  return [...entries]
    .sort(
      (a, b) =>
        a.hints_used - b.hints_used ||
        a.duration_seconds - b.duration_seconds ||
        new Date(a.solved_at).getTime() - new Date(b.solved_at).getTime()
    )
    .slice(0, 10)
    .map((entry, idx) => ({ rank: idx + 1, ...entry }));
}
