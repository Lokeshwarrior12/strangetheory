import { z } from 'zod';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, validatePasswordStrength } from './passwords.js';

export const signupSchema = z
  .object({
    email: z.string().trim().email('Enter a valid email address'),
    username: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters')
      .max(24, 'Username must be at most 24 characters')
      .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
    display_name: z.string().trim().min(2, 'Display name is required').max(40),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(MAX_PASSWORD_LENGTH),
  })
  .superRefine((val, ctx) => {
    const issue = validatePasswordStrength(val.password, { email: val.email, username: val.username });
    if (issue) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: issue });
    }
  });

export const loginSchema = z.object({
  emailOrUsername: z.string().trim().min(1, 'Email or username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const resetPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
});

export const confirmResetSchema = z
  .object({
    token: z.string().trim().min(8, 'Reset token is required'),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(MAX_PASSWORD_LENGTH),
  })
  .superRefine((val, ctx) => {
    const issue = validatePasswordStrength(val.password);
    if (issue) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: issue });
    }
  });

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `New password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(MAX_PASSWORD_LENGTH),
  })
  .superRefine((val, ctx) => {
    const issue = validatePasswordStrength(val.new_password);
    if (issue) {
      ctx.addIssue({ code: 'custom', path: ['new_password'], message: issue });
    }
  });

export const changeEmailSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  current_password: z.string().min(1, 'Current password is required to change email'),
});

export const experimentBodySchema = z.object({
  premise: z.string().trim().min(1, 'Premise is required').max(8000, 'Premise exceeds 8,000 characters'),
  ripples: z.string().trim().max(8000, 'Ripple effects exceed 8,000 characters').default(''),
  breaks_down: z.string().trim().max(8000, 'Where this breaks down exceeds 8,000 characters').default(''),
  free_content: z.string().trim().max(8000, 'Free content exceeds 8,000 characters').optional().default(''),
  tags: z.array(z.string().trim().min(1).max(28)).max(5).optional(),
});

export const riddleInputSchema = z.object({
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  riddle_type: z.enum(['Logic', 'Lateral', 'Math', 'Wordplay', 'Science']),
  hints: z.array(z.string().trim().min(1).max(300)).max(3, 'Maximum 3 hints allowed'),
  answer_text: z.string().trim().min(1, 'Official answer is required').max(500),
  answer_keywords: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  explanation: z.string().trim().min(1, 'Official explanation is required').max(4000),
  reveal_mode: z.enum(['author', 'auto']).default('auto'),
  reveal_days: z.number().int().min(1).max(30).default(7),
});

export const safeImageUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (val) =>
      val === '' ||
      /^https?:\/\//i.test(val) ||
      val.startsWith('/api/assets/') ||
      val.startsWith('/covers/') ||
      val.startsWith('/src/assets/') ||
      val.startsWith('/api/covers/'),
    'Image URL must use https:// or an approved hosted asset path'
  );

export const createPostSchema = z.object({
  type: z.enum(['experiment', 'riddle']),
  title: z.string().trim().min(4, 'Title must be at least 4 characters').max(140, 'Title must be at most 140 characters'),
  intro: z
    .string()
    .trim()
    .min(10, 'Summary or question must be at least 10 characters')
    .max(280, 'Intro must be 280 characters or fewer'),
  cover_url: safeImageUrlSchema.nullable().optional(),
  perspective: z.enum(['Past', 'Present', 'Future', 'Timeless']).default('Present'),
  thinking_style: z.enum(['Science-backed', 'Plausible', 'Speculative', 'Wild imagination']).default('Speculative'),
  category_ids: z
    .array(z.string().trim().min(1))
    .min(1, 'Choose at least 1 category')
    .max(2, 'Maximum 2 categories per post'),
  body_json: experimentBodySchema.optional(),
  riddle: riddleInputSchema.optional(),
  ai_assisted: z.boolean().default(false),
  ai_disclosure: z.string().trim().max(300).nullable().optional(),
  forked_from_id: z.string().nullable().optional(),
});

export const updatePostSchema = createPostSchema.partial();

export const createCommentSchema = z.object({
  lens: z.enum(['ripples', 'stress_test', 'branches', 'answer']),
  parent_id: z.string().nullable().optional(),
  body: z
    .string()
    .trim()
    .min(2, 'Comment must be at least 2 characters')
    .max(1000, 'Comments are capped at 1,000 characters'),
});

export const reactionSchema = z.object({
  target_type: z.enum(['post', 'comment']),
  target_id: z.string().min(1),
  kind: z.enum(['mind_blown', 'strong_logic', 'needs_evidence', 'changed_mind']),
});

export const mindChangeSchema = z.object({
  phase: z.enum(['before', 'after']),
  score: z.number().int().min(0).max(100),
});

export const reportSchema = z.object({
  target_type: z.enum(['post', 'comment']),
  target_id: z.string().min(1),
  reason: z.string().trim().min(5, 'Please provide a brief reason').max(500),
});

export const appealSchema = z.object({
  target_type: z.enum(['post', 'comment', 'user']),
  target_id: z.string().min(1),
  reason: z.string().trim().min(10, 'Explain why this decision should be reconsidered').max(800),
});

export const profileUpdateSchema = z.object({
  display_name: z.string().trim().min(2).max(40).optional(),
  bio: z.string().trim().max(280).optional(),
  interests: z.array(z.string().trim().min(1).max(32)).max(6).optional(),
  avatar_url: safeImageUrlSchema.optional(),
  daily_digest_enabled: z.boolean().optional(),
  weekly_digest_enabled: z.boolean().optional(),
  reading_goal_per_week: z.number().int().refine((v) => [1, 3, 5].includes(v), 'Goal must be 1, 3, or 5').optional(),
});

export const onboardingSchema = z.object({
  skip: z.boolean().optional().default(false),
  favorite_category_ids: z.array(z.string().trim().min(1)).max(3, 'Pick up to 3 regions').optional().default([]),
  reading_goal_per_week: z
    .number()
    .int()
    .refine((v) => [1, 3, 5].includes(v), 'Weekly goal must be 1, 3, or 5')
    .optional()
    .default(3),
  weekly_digest_enabled: z.boolean().optional(),
});

export const readingProgressSchema = z.object({
  progress_pct: z.number().int().min(0).max(100),
  last_section: z.string().trim().max(80).optional().default(''),
});

export const createCollectionSchema = z.object({
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(80, 'Title max 80 characters'),
  note: z.string().trim().max(240, 'Note max 240 characters').optional().default(''),
  is_public: z.boolean().optional().default(true),
});

export const updateCollectionSchema = createCollectionSchema.partial();

export const moderationActionSchema = z.object({
  report_id: z.string().trim().min(1).optional(),
  appeal_id: z.string().trim().min(1).optional(),
  target_type: z.enum(['post', 'comment', 'user', 'report']),
  target_id: z.string().trim().min(1, 'Target ID is required'),
  action: z.enum([
    'hide',
    'restore',
    'warn',
    'ban',
    'unban',
    'dismiss_report',
    'approve_appeal',
    'reject_appeal',
  ]),
  note: z.string().trim().max(500).optional().default(''),
});

export const nonEmptyParamSchema = z
  .string()
  .trim()
  .min(1, 'Identifier is required')
  .max(180, 'Identifier is too long');

export const googleAuthSchema = z.object({
  id_token: z.string().trim().min(10, 'Missing Google ID token.').max(8192),
});

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(8, 'Verification token is required.').max(256),
});

export const uploadImageSchema = z.object({
  dataUrl: z.string().trim().min(10, 'Missing image data.').max(8_000_000, 'Image payload exceeds 5 MB limit.'),
});

export const postsQuerySchema = z.object({
  category: z.string().trim().max(120).optional().default(''),
  type: z.enum(['all', 'experiment', 'riddle']).optional().default('all'),
  sort: z.enum(['trending', 'newest', 'discussed']).optional().default('trending'),
  authorId: z.string().trim().max(120).optional().default(''),
  includeDrafts: z.enum(['0', '1', 'true', 'false']).optional(),
  cursor: z.coerce.number().int().min(0).max(10000).optional().default(0),
  limit: z.coerce.number().int().min(1).max(48).optional().default(12),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  type: z.enum(['all', 'experiment', 'riddle']).optional().default('all'),
  category: z.string().trim().max(80).optional().default(''),
  sort: z.enum(['relevance', 'newest', 'discussed']).optional().default('relevance'),
});

export const commentsQuerySchema = z.object({
  lens: z.enum(['ripples', 'stress_test', 'branches', 'answer']).optional(),
  sort: z.enum(['top', 'newest', 'insightful']).optional().default('top'),
  cursor: z.coerce.number().int().min(0).max(10000).optional().default(0),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});

export const realtimeCommentsQuerySchema = z.object({
  lens: z.enum(['ripples', 'stress_test', 'branches', 'answer']).optional(),
  since: z
    .string()
    .trim()
    .max(64)
    .refine((v) => !v || Number.isFinite(Date.parse(v)), 'Invalid ISO timestamp')
    .optional(),
});

export const userSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional().default(''),
});

export const leaderboardQuerySchema = z.object({
  window: z.enum(['week', 'month', 'all']).optional().default('all'),
});

export const digestUnsubscribeQuerySchema = z.object({
  token: z.string().trim().max(300).optional().default(''),
  format: z.enum(['json', 'html']).optional(),
});

export const collectionsQuerySchema = z.object({
  username: z.string().trim().max(40).optional().default(''),
  postId: z.string().trim().max(120).optional().default(''),
});

export const addCollectionItemSchema = z.object({
  post_id: z.string().trim().min(1, 'Post ID is required.').max(120),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(['member', 'moderator', 'admin']),
});

export const analyticsEventSchema = z.object({
  event_name: z.string().trim().min(1).max(60).optional().default('page_view'),
  route: z.string().trim().max(140).optional().default('/'),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const clientErrorSchema = z.object({
  message: z.string().trim().min(1).max(1000).optional().default('Client error'),
  stack: z.string().max(4000).optional().default(''),
  route: z.string().trim().max(200).optional().default(''),
});

