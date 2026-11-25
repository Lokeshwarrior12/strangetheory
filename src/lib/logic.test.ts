import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateReadingTime,
  normalizeAnswer,
  isLikelyAnswerMatch,
  calculateRiddleSolvePoints,
  calculateTrendingScore,
  slugifyTitle,
  calculateMindChangeStats,
  sumPointsInWindow,
} from './scoring.js';
import { sanitizeRichText, containsExternalLink } from './sanitize.js';

test('calculateReadingTime divides words by 200 rounded up with minimum 1', () => {
  assert.equal(calculateReadingTime('hello world'), 1);
  const words201 = Array.from({ length: 201 }, () => 'word').join(' ');
  assert.equal(calculateReadingTime(words201), 2);
  assert.equal(calculateReadingTime('<p>Short <strong>essay</strong></p>'), 1);
});

test('normalizeAnswer removes punctuation, case, and filler words', () => {
  assert.equal(normalizeAnswer('  The Echo! '), 'echo');
  assert.equal(normalizeAnswer('It is a shadow, on the wall.'), 'shadow wall');
});

test('isLikelyAnswerMatch matches normalized keywords safely', () => {
  assert.equal(isLikelyAnswerMatch('A shadow!', ['shadow', 'silhouette']), true);
  assert.equal(isLikelyAnswerMatch('An echo in the canyon', ['echo']), true);
  assert.equal(isLikelyAnswerMatch('Quantum entanglement', ['shadow']), false);
});

test('calculateRiddleSolvePoints enforces difficulty, hint penalty, floor of 1, and first solver bonus', () => {
  assert.equal(calculateRiddleSolvePoints('Easy', 0, false), 3);
  assert.equal(calculateRiddleSolvePoints('Easy', 3, false), 1); // never below 1
  assert.equal(calculateRiddleSolvePoints('Medium', 1, false), 5);
  assert.equal(calculateRiddleSolvePoints('Hard', 2, true), 13); // 10 - 2 + 5
  assert.equal(calculateRiddleSolvePoints('Hard', 1, true), 14); // 10 - 1 + 5
});

test('calculateTrendingScore follows decay formula', () => {
  const score = calculateTrendingScore({
    views: 100,
    insights: 10,
    comments: 5,
    bookmarks: 5,
    ageHours: 2,
  });
  // (20 + 30 + 10 + 10) / (4^1.5) = 70 / 8 = 8.75
  assert.equal(score, 8.75);
});

test('sanitizeRichText strips script tags and event handlers while keeping safe formatting and images', () => {
  const dirty =
    '<p onclick="alert(1)">Hello <strong>world</strong><script>evil()</script><a href="javascript:alert(1)">bad</a><a href="https://strangetheory.app">good</a><img src="/api/assets/diagram.png" onerror="alert(2)" alt="Brain map" /><img src="javascript:alert(3)" /></p>';
  const clean = sanitizeRichText(dirty);
  assert.equal(clean.includes('<script>'), false);
  assert.equal(clean.includes('onclick'), false);
  assert.equal(clean.includes('onerror'), false);
  assert.equal(clean.includes('javascript:'), false);
  assert.equal(clean.includes('<strong>world</strong>'), true);
  assert.equal(clean.includes('href="https://strangetheory.app"'), true);
  assert.equal(clean.includes('src="/api/assets/diagram.png"'), true);
});

test('containsExternalLink detects URLs for 24h new account restriction', () => {
  assert.equal(containsExternalLink('Check out https://example.com'), true);
  assert.equal(containsExternalLink('Visit www.example.org today'), true);
  assert.equal(containsExternalLink('Just a thoughtful reply with no links.'), false);
});

test('slugifyTitle builds clean URL slugs', () => {
  assert.equal(slugifyTitle('What If Gravity Reversed Every Midnight?'), 'what-if-gravity-reversed-every-midnight');
});

test('calculateMindChangeStats computes before/after averages and paired delta', () => {
  const stats = calculateMindChangeStats([
    { before_score: 30, after_score: 70 },
    { before_score: 50, after_score: 60 },
    { before_score: 40, after_score: null },
  ]);
  assert.equal(stats.before_avg, 40);
  assert.equal(stats.after_avg, 65);
  assert.equal(stats.delta_avg, 25);
  assert.equal(stats.vote_count, 3);
});

test('sumPointsInWindow filters Synapse events by week, month, and all time', () => {
  const now = Date.now();
  const daysAgoIso = (d: number) => new Date(now - d * 86400_000).toISOString();
  const events = [
    { id: '1', user_id: 'u1', reason: 'Recent', points: 5, source_id: 'p1', created_at: daysAgoIso(2) },
    { id: '2', user_id: 'u1', reason: 'Two weeks', points: 10, source_id: 'p2', created_at: daysAgoIso(14) },
    { id: '3', user_id: 'u1', reason: 'Old', points: 20, source_id: 'p3', created_at: daysAgoIso(45) },
    { id: '4', user_id: 'u2', reason: 'Recent', points: 7, source_id: 'p4', created_at: daysAgoIso(1) },
  ];
  const week = sumPointsInWindow(events, 'week', now);
  const month = sumPointsInWindow(events, 'month', now);
  const all = sumPointsInWindow(events, 'all', now);

  assert.equal(week.get('u1'), 5);
  assert.equal(week.get('u2'), 7);
  assert.equal(month.get('u1'), 15);
  assert.equal(all.get('u1'), 35);
});

test('sanitizeRichText neutralizes svg/iframe/data/protocol-relative and control-char XSS payloads', () => {
  const vectors = [
    '<svg onload="alert(1)"><circle /></svg>',
    '<iframe src="https://evil.example/phish"></iframe>',
    '<a href="java\u0009script:alert(1)">click</a>',
    '<a href="//evil.example/redirect">rel</a>',
    '<img src="data:image/svg+xml;base64,PHN2Zz4=" onerror="alert(1)" />',
    '<p style="background:url(javascript:alert(1))" onmouseover="alert(1)">Safe text</p>',
  ];
  for (const v of vectors) {
    const clean = sanitizeRichText(v);
    assert.equal(/<script|<svg|<iframe|onerror|onload|onmouseover|javascript:|data:image\/svg/i.test(clean), false, `Vector leaked: ${clean}`);
    assert.equal(clean.includes('//evil.example'), false, `Protocol-relative URL leaked: ${clean}`);
  }
});

test('safeImageUrlSchema & moderationActionSchema reject unsafe inputs', async () => {
  const { safeImageUrlSchema, moderationActionSchema } = await import('./schemas.js');
  assert.equal(safeImageUrlSchema.safeParse('javascript:alert(1)').success, false);
  assert.equal(safeImageUrlSchema.safeParse('//evil.com/x.png').success, false);
  assert.equal(safeImageUrlSchema.safeParse('data:text/html,<script>').success, false);
  assert.equal(safeImageUrlSchema.safeParse('/api/assets/abc.webp').success, true);
  assert.equal(safeImageUrlSchema.safeParse('/covers/cover_neural_synapse_1794881588195.jpg').success, true);
  assert.equal(safeImageUrlSchema.safeParse('https://cdn.strangetheory.app/cover.jpg').success, true);

  assert.equal(
    moderationActionSchema.safeParse({ target_type: 'user', target_id: 'u1', action: 'ban', note: 'spam' }).success,
    true
  );
  assert.equal(
    moderationActionSchema.safeParse({ target_type: 'user', target_id: 'u1', action: 'promote_admin' }).success,
    false
  );
});

test('validatePasswordStrength enforces >=10 chars, blocks common passwords, and rejects username/email substrings', async () => {
  const { validatePasswordStrength } = await import('./passwords.js');
  assert.ok(validatePasswordStrength('short123'));
  assert.ok(validatePasswordStrength('password1234'));
  assert.ok(validatePasswordStrength('strangetheory2026'));
  assert.ok(validatePasswordStrength('aaaaaaaaaaaa'));
  assert.ok(validatePasswordStrength('my_alice_secret99', { username: 'alice', email: 'alice@example.com' }));
  assert.equal(validatePasswordStrength('Velvet-Photon-942!', { username: 'alice', email: 'alice@example.com' }), null);
});

test('calculateCurrentStreakDays counts consecutive UTC days ending today or yesterday', async () => {
  const { calculateCurrentStreakDays } = await import('./scoring.js');
  const dayMs = 86400_000;
  const baseNow = Date.UTC(2026, 10, 18, 12, 0, 0);
  const isoDaysAgo = (d: number) => new Date(baseNow - d * dayMs).toISOString();

  assert.equal(calculateCurrentStreakDays([], baseNow), 0);
  assert.equal(calculateCurrentStreakDays([isoDaysAgo(3)], baseNow), 0);
  assert.equal(calculateCurrentStreakDays([isoDaysAgo(0), isoDaysAgo(1), isoDaysAgo(2), isoDaysAgo(4)], baseNow), 3);
  assert.equal(calculateCurrentStreakDays([isoDaysAgo(1), isoDaysAgo(2)], baseNow), 2);
});

test('computeBrainBadges caps at 12 badges and marks earned thresholds cleanly', async () => {
  const { computeBrainBadges } = await import('./scoring.js');
  const badges = computeBrainBadges({
    regionActivity: { 'cat-physics': 12, 'cat-ai': 4 },
    regionsExplored: 10,
    riddlesSolved: 3,
    streakDays: 7,
  });
  assert.equal(badges.length, 12);
  const physicsBadge = badges.find((b) => b.category_slug === 'physics-cosmos');
  assert.ok(physicsBadge);
  assert.equal(physicsBadge.earned, true);
  assert.equal(badges.find((b) => b.id === 'badge-all-regions')?.earned, true);
  assert.equal(badges.find((b) => b.id === 'badge-weekly-synapse')?.earned, true);
  assert.equal(badges.find((b) => b.category_slug === 'ai-computation')?.earned, false);
});

test('getIsoWeekKey & rankWeeklyChallengeEntries sort by fewest hints then fastest time (top 10)', async () => {
  const { getIsoWeekKey, rankWeeklyChallengeEntries } = await import('./scoring.js');
  const wk = getIsoWeekKey(new Date('2026-11-18T15:00:00Z'));
  assert.match(wk.weekKey, /^\d{4}-W\d{2}$/);
  assert.ok(wk.startsAt < wk.endsAt);

  const raw = Array.from({ length: 12 }, (_, idx) => ({
    user_id: `u${idx}`,
    hints_used: idx % 3,
    duration_seconds: 100 - idx * 5,
    solved_at: new Date(Date.UTC(2026, 10, 18, 12, idx, 0)).toISOString(),
  }));
  const ranked = rankWeeklyChallengeEntries(raw);
  assert.equal(ranked.length, 10);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[0].hints_used, 0);
  assert.ok(ranked[0].duration_seconds <= ranked[1].duration_seconds);
});
