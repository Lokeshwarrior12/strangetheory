import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  awardSynapse,
  enrichComment,
  enrichPost,
  executeSql,
  getFallbackUploadedAsset,
  getOrCreateWeeklyChallenge,
  getPostById,
  getRiddlePublic,
  getRiddleSecret,
  getUserById,
  logServerError,
  notifyRiddleAnswerersRevealed,
  query,
  queryOne,
  recordOutboxEmail,
  rowToComment,
  rowToPost,
  rowToProfile,
  runDailyMaintenance,
  runWeeklyDigestDispatch,
  saveFallbackUploadedAsset,
  syncRiddleAutoReveal,
  verifyWeeklyDigestUnsubscribeToken,
  withTransaction,
} from './db';
import { renderProceduralCoverSvg } from './covers';
import { dispatchEmail } from './email';
import { captureServerException } from './monitoring';
import { hashPassword, verifyPassword } from './seed';
import { saveUploadedImage, StorageConfigError } from './storage';
import { CATEGORIES, CATEGORY_BY_ID, CATEGORY_BY_SLUG } from '../src/lib/categories';
import { APP_NAME, DEFAULT_CONTACT_EMAIL, FOCUS_LIMITS } from '../src/lib/config';
import {
  appealSchema,
  changeEmailSchema,
  changePasswordSchema,
  confirmResetSchema,
  createCollectionSchema,
  createCommentSchema,
  createPostSchema,
  loginSchema,
  mindChangeSchema,
  moderationActionSchema,
  onboardingSchema,
  profileUpdateSchema,
  reactionSchema,
  readingProgressSchema,
  reportSchema,
  resetPasswordSchema,
  signupSchema,
  updateCollectionSchema,
  updatePostSchema,
} from '../src/lib/schemas';
import {
  calculateCurrentStreakDays,
  calculateMindChangeStats,
  calculateReadingTime,
  calculateRiddleSolvePoints,
  computeBrainBadges,
  isLikelyAnswerMatch,
  rankWeeklyChallengeEntries,
  slugifyTitle,
  sumPointsInWindow,
} from '../src/lib/scoring';
import { containsExternalLink, sanitizePlainText, sanitizeRichText } from '../src/lib/sanitize';
import type {
  ApiErrorShape,
  AuthorDashboardEntry,
  CollectionDetail,
  CollectionSummary,
  CommentLens,
  EnrichedPost,
  MyBrainData,
  Post,
  Profile,
  SynapseEvent,
  UserRole,
  WeeklyChallengeData,
} from '../src/lib/types';

const SESSION_SECRET = process.env.SESSION_SECRET || 'strangetheory_local_session_secret_key_2026';
const SESSION_COOKIE = 'st_session';
const CSRF_COOKIE = 'st_csrf';

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function signToken(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, ts, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${userId}.${ts}`).digest('hex');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return userId;
}

async function getViewer(req: Request): Promise<Profile | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  const userId = verifyToken(token);
  if (!userId) return null;
  const profile = await getUserById(userId, true);
  if (!profile || profile.banned) return null;
  return profile;
}

function isSecureCookieRequest(req?: Request): boolean {
  const forwardedProto = req?.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const isProd = process.env.NODE_ENV === 'production';
  return (
    Boolean(req?.secure) ||
    forwardedProto === 'https' ||
    (isProd && process.env.FORCE_HTTPS === 'true')
  );
}

function setSessionCookie(res: Response, userId: string, req?: Request): string {
  const secure = isSecureCookieRequest(req);
  res.cookie(SESSION_COOKIE, signToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000,
  });
  return ensureCsrfCookie(res, undefined, req);
}

function ensureCsrfCookie(res: Response, existing?: string, req?: Request): string {
  const token = existing || crypto.randomBytes(16).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isSecureCookieRequest(req),
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000,
  });
  return token;
}

function clearSessionCookie(res: Response, req?: Request): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookieRequest(req),
    path: '/',
  });
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  fields?: Array<{ field: string; message: string }>
) {
  const payload: ApiErrorShape = { code, message, ...(fields ? { fields } : {}) };
  return res.status(status).json(payload);
}

function zodErrorToFields(err: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return err.issues.map((issue) => ({
    field: issue.path.map(String).join('.') || 'root',
    message: issue.message,
  }));
}

type RateAction = 'publish' | 'comment' | 'reaction' | 'report' | 'login' | 'signup' | 'reset' | 'upload';

async function checkRateLimit(userOrIpKey: string, action: RateAction, limit: number, windowMs: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const row = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM rate_events WHERE user_id = $1 AND action = $2 AND created_at >= $3',
    [userOrIpKey, action, cutoff]
  );
  return Number(row?.cnt || 0) < limit;
}

async function recordRateEvent(userOrIpKey: string, action: RateAction): Promise<void> {
  await executeSql('INSERT INTO rate_events (user_id, action, created_at) VALUES ($1, $2, $3)', [
    userOrIpKey,
    action,
    new Date().toISOString(),
  ]);
}

function getClientIpKey(req: Request): string {
  const fwd = req.get('x-forwarded-for')?.split(',')[0]?.trim();
  return `ip:${fwd || req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

function isNewAccount(profile: Profile): boolean {
  return Date.now() - new Date(profile.created_at).getTime() < FOCUS_LIMITS.NEW_ACCOUNT_HOURS * 3600_000;
}

async function getAllPublishedPosts(): Promise<Post[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM posts WHERE status = 'published'");
  return rows.map(rowToPost);
}

function resolveAppOrigin(req: Request): string {
  if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const host = req.get('host') || 'localhost:3000';
  const fwdProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = fwdProto || req.protocol || 'http';
  return `${proto}://${host}`;
}

export const apiRouter = express.Router();

// CSRF & Origin guard for authenticated mutating routes
apiRouter.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (
    req.path === '/analytics/event' ||
    req.path === '/errors' ||
    req.path === '/cron/daily' ||
    req.path === '/cron/weekly'
  ) {
    return next();
  }

  if (req.cookies?.[SESSION_COOKIE]) {
    const csrfCookie = String(req.cookies?.[CSRF_COOKIE] || '');
    const csrfHeader = String(req.get('x-csrf-token') || '');
    if (
      !csrfCookie ||
      !csrfHeader ||
      csrfCookie.length !== csrfHeader.length ||
      !crypto.timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfHeader))
    ) {
      return sendError(res, 403, 'CSRF_MISMATCH', 'Security token mismatch. Refresh and try again.');
    }
    const origin = req.get('origin');
    const host = req.get('host');
    if (origin && host) {
      try {
        if (new URL(origin).host !== host) {
          return sendError(res, 403, 'ORIGIN_MISMATCH', 'Cross-origin mutation blocked.');
        }
      } catch {
        return sendError(res, 403, 'ORIGIN_MISMATCH', 'Invalid request origin.');
      }
    }
  }
  return next();
});

// --- SCHEDULED MAINTENANCE CRON (NO SETINTERVAL TIMERS IN SERVERLESS) ---
function verifyCronSecret(req: Request, res: Response): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (process.env.NODE_ENV === 'production' && !secret) {
    sendError(res, 503, 'CRON_NOT_CONFIGURED', 'CRON_SECRET must be set in production.');
    return false;
  }
  if (secret) {
    const auth = req.get('authorization') || '';
    const expected = `Bearer ${secret}`;
    if (
      auth.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
    ) {
      sendError(res, 401, 'UNAUTHORIZED', 'Valid cron authorization required.');
      return false;
    }
  }
  return true;
}

async function handleCronDaily(req: Request, res: Response) {
  if (!verifyCronSecret(req, res)) return;
  const result = await runDailyMaintenance(resolveAppOrigin(req));
  return res.json({ ok: true, ...result });
}

async function handleCronWeekly(req: Request, res: Response) {
  if (!verifyCronSecret(req, res)) return;
  const challenge = await getOrCreateWeeklyChallenge();
  const weeklyEmailsSent = await runWeeklyDigestDispatch(resolveAppOrigin(req));
  return res.json({ ok: true, weeklyChallengeWeekKey: challenge.weekKey, weeklyEmailsSent });
}

apiRouter.get('/cron/daily', asyncHandler(handleCronDaily));
apiRouter.post('/cron/daily', asyncHandler(handleCronDaily));
apiRouter.get('/cron/weekly', asyncHandler(handleCronWeekly));
apiRouter.post('/cron/weekly', asyncHandler(handleCronWeekly));

// --- AUTH ---
apiRouter.get(
  '/auth/me',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const csrf = ensureCsrfCookie(res, req.cookies?.[CSRF_COOKIE], req);
    res.json({
      user: viewer,
      csrf_token: csrf,
      demo_accounts: [],
      google_enabled: Boolean(process.env.GOOGLE_CLIENT_ID),
      contact_email: process.env.CONTACT_EMAIL?.trim() || DEFAULT_CONTACT_EMAIL,
    });
  })
);

apiRouter.post(
  '/auth/signup',
  asyncHandler(async (req, res) => {
    const ipKey = getClientIpKey(req);
    if (!(await checkRateLimit(ipKey, 'signup', 10, 3600_000))) {
      return sendError(res, 429, 'RATE_LIMITED', 'Too many account creation attempts. Please try again later.');
    }
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Please check your input fields.', zodErrorToFields(parsed.error));
    }
    await recordRateEvent(ipKey, 'signup');
    const emailLower = parsed.data.email.toLowerCase();
    const usernameLower = parsed.data.username.toLowerCase();

    if (await queryOne('SELECT 1 FROM users WHERE LOWER(email) = $1', [emailLower])) {
      return sendError(res, 409, 'EMAIL_EXISTS', 'An account with that email already exists.', [
        { field: 'email', message: 'Email already registered' },
      ]);
    }
    if (await queryOne('SELECT 1 FROM users WHERE LOWER(username) = $1', [usernameLower])) {
      return sendError(res, 409, 'USERNAME_EXISTS', 'That username is already taken.', [
        { field: 'username', message: 'Username already taken' },
      ]);
    }

    const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { hash, salt } = hashPassword(parsed.data.password);
    const nowIso = new Date().toISOString();
    const displayName = sanitizePlainText(parsed.data.display_name);

    await executeSql(
      `INSERT INTO users (
        id, email, username, display_name, avatar_url, bio, interests_json,
        synapse_total, role, badges_json, banned, email_verified, daily_digest_enabled,
        password_hash, salt, is_seed, created_at
      ) VALUES ($1, $2, $3, $4, '', '', '[]', 0, 'member', '[]', 0, 0, 1, $5, $6, 0, $7)`,
      [userId, emailLower, parsed.data.username, displayName, hash, salt, nowIso]
    );

    const verifyToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 3600_000).toISOString();
    await executeSql(
      'INSERT INTO email_tokens (token, user_id, kind, new_email, expires_at, created_at) VALUES ($1, $2, $3, NULL, $4, $5)',
      [verifyToken, userId, 'verify_email', expiresAt, nowIso]
    );

    const verifyUrl = `${resolveAppOrigin(req)}/verify-email?token=${verifyToken}`;
    const mailResult = await dispatchEmail({
      to: emailLower,
      subject: `Verify your ${APP_NAME} email`,
      text: `Welcome to ${APP_NAME}, ${displayName}. Verify your email address to publish experiments and riddles.`,
      actionUrl: verifyUrl,
      recordOutbox: recordOutboxEmail,
    });

    const csrfToken = setSessionCookie(res, userId, req);
    const profile = await getUserById(userId, true);
    const isProd = process.env.NODE_ENV === 'production';
    res.status(201).json({
      user: profile,
      csrf_token: csrfToken,
      ...( !isProd && mailResult.previewUrl ? { verification_preview_url: mailResult.previewUrl } : {} ),
    });
  })
);

apiRouter.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const ipKey = getClientIpKey(req);
    if (!(await checkRateLimit(ipKey, 'login', 20, 15 * 60_000))) {
      return sendError(res, 429, 'RATE_LIMITED', 'Too many sign-in attempts. Wait a few minutes before retrying.');
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Enter your credentials.', zodErrorToFields(parsed.error));
    }
    const queryStr = parsed.data.emailOrUsername.toLowerCase();
    const acctKey = `acct:${queryStr}`;
    if (!(await checkRateLimit(acctKey, 'login', 10, 15 * 60_000))) {
      return sendError(res, 429, 'RATE_LIMITED', 'Too many failed attempts for this account. Try again in 15 minutes.');
    }

    const row = await queryOne<Record<string, unknown>>(
      'SELECT * FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2',
      [queryStr, queryStr]
    );

    if (!row || !verifyPassword(parsed.data.password, String(row.salt), String(row.password_hash))) {
      await recordRateEvent(ipKey, 'login');
      await recordRateEvent(acctKey, 'login');
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email/username or password.');
    }
    if (Number(row.banned) === 1) {
      return sendError(res, 403, 'ACCOUNT_SUSPENDED', 'This account has been suspended by moderation.');
    }
    const profile = rowToProfile(row, true);
    const csrfToken = setSessionCookie(res, profile.id, req);
    res.json({ user: profile, csrf_token: csrfToken });
  })
);

apiRouter.post(
  '/auth/google',
  asyncHandler(async (req, res) => {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      return sendError(
        res,
        501,
        'GOOGLE_OAUTH_NOT_CONFIGURED',
        'Google Sign-In is not configured on this server (missing GOOGLE_CLIENT_ID). Please sign in with email and password.'
      );
    }
    const idToken = String(req.body?.id_token || '');
    if (!idToken) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Missing Google ID token.');
    }
    try {
      const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!resp.ok) {
        return sendError(res, 401, 'INVALID_GOOGLE_TOKEN', 'Unable to verify Google Sign-In token.');
      }
      const payload = (await resp.json()) as {
        aud?: string;
        sub?: string;
        email?: string;
        email_verified?: string;
        name?: string;
      };
      if (payload.aud !== googleClientId || !payload.email || !payload.sub) {
        return sendError(res, 401, 'INVALID_GOOGLE_TOKEN', 'Google token audience or email mismatch.');
      }
      const emailLower = payload.email.toLowerCase();
      let row = await queryOne<Record<string, unknown>>(
        'SELECT * FROM users WHERE google_sub = $1 OR LOWER(email) = $2',
        [payload.sub, emailLower]
      );

      if (!row) {
        const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const baseHandle = emailLower.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 16) || 'thinker';
        let username = baseHandle;
        let n = 1;
        while (await queryOne('SELECT 1 FROM users WHERE LOWER(username) = $1', [username.toLowerCase()])) {
          username = `${baseHandle}_${n++}`;
        }
        const { hash, salt } = hashPassword(crypto.randomBytes(24).toString('hex'));
        await executeSql(
          `INSERT INTO users (
            id, email, username, display_name, avatar_url, bio, interests_json,
            synapse_total, role, badges_json, banned, email_verified, daily_digest_enabled,
            google_sub, password_hash, salt, is_seed, created_at
          ) VALUES ($1, $2, $3, $4, '', '', '[]', 0, 'member', '[]', 0, 1, 1, $5, $6, $7, 0, $8)`,
          [
            userId,
            emailLower,
            username,
            sanitizePlainText(payload.name || username),
            payload.sub,
            hash,
            salt,
            new Date().toISOString(),
          ]
        );
        row = await queryOne<Record<string, unknown>>('SELECT * FROM users WHERE id = $1', [userId]);
      }
      if (!row || Number(row.banned) === 1) {
        return sendError(res, 403, 'ACCOUNT_SUSPENDED', 'This account has been suspended by moderation.');
      }
      const profile = rowToProfile(row, true);
      const csrfToken = setSessionCookie(res, profile.id, req);
      res.json({ user: profile, csrf_token: csrfToken });
    } catch {
      return sendError(res, 502, 'GOOGLE_VERIFY_FAILED', 'Failed to reach Google verification service.');
    }
  })
);

apiRouter.post(
  '/auth/demo-switch',
  asyncHandler(async (_req, res) => {
    return sendError(res, 403, 'DEMO_DISABLED', 'Demo sign-in is disabled. Create an account or sign in with your credentials.');
  })
);

apiRouter.post('/auth/logout', (req, res) => {
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

apiRouter.post(
  '/auth/verify-email',
  asyncHandler(async (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Verification token is required.');
    }
    const row = await queryOne<{ token: string; user_id: string; new_email: string | null; expires_at: string; used_at: string | null }>(
      "SELECT token, user_id, new_email, expires_at, used_at FROM email_tokens WHERE token = $1 AND kind = 'verify_email'",
      [token]
    );
    if (!row || row.used_at || Date.now() > new Date(row.expires_at).getTime()) {
      return sendError(res, 400, 'INVALID_TOKEN', 'This verification link is invalid or has expired.');
    }
    const nowIso = new Date().toISOString();
    await withTransaction(async (tx) => {
      if (row.new_email) {
        await tx.executeSql('UPDATE users SET email = $1, email_verified = 1 WHERE id = $2', [row.new_email, row.user_id]);
      } else {
        await tx.executeSql('UPDATE users SET email_verified = 1 WHERE id = $1', [row.user_id]);
      }
      await tx.executeSql('UPDATE email_tokens SET used_at = $1 WHERE token = $2', [nowIso, token]);
    });
    const profile = await getUserById(row.user_id, true);
    res.json({ ok: true, user: profile });
  })
);

apiRouter.post(
  '/auth/resend-verification',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer || !viewer.email) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to verify your email.');
    }
    const ipKey = getClientIpKey(req);
    if (!(await checkRateLimit(ipKey, 'reset', 10, 3600_000))) {
      return sendError(res, 429, 'RATE_LIMITED', 'Too many verification requests. Please try again later.');
    }
    await recordRateEvent(ipKey, 'reset');

    const token = crypto.randomBytes(24).toString('hex');
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 3600_000).toISOString();
    await withTransaction(async (tx) => {
      await tx.executeSql(
        "UPDATE email_tokens SET used_at = $1 WHERE user_id = $2 AND kind = 'verify_email' AND used_at IS NULL",
        [nowIso, viewer.id]
      );
      await tx.executeSql(
        'INSERT INTO email_tokens (token, user_id, kind, new_email, expires_at, created_at) VALUES ($1, $2, $3, NULL, $4, $5)',
        [token, viewer.id, 'verify_email', expiresAt, nowIso]
      );
    });

    const verifyUrl = `${resolveAppOrigin(req)}/verify-email?token=${token}`;
    const mailResult = await dispatchEmail({
      to: viewer.email,
      subject: `Verify your ${APP_NAME} email`,
      text: `Confirm your email address for ${APP_NAME}.`,
      actionUrl: verifyUrl,
      recordOutbox: recordOutboxEmail,
    });
    const isProd = process.env.NODE_ENV === 'production';
    res.json({
      ok: true,
      message: 'Verification link dispatched.',
      ...( !isProd && mailResult.previewUrl ? { preview_url: mailResult.previewUrl } : {} ),
    });
  })
);

apiRouter.post(
  '/auth/reset-password',
  asyncHandler(async (req, res) => {
    const ipKey = getClientIpKey(req);
    if (!(await checkRateLimit(ipKey, 'reset', 10, 3600_000))) {
      return sendError(res, 429, 'RATE_LIMITED', 'Too many password reset requests. Please try again later.');
    }
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Enter a valid email address.', zodErrorToFields(parsed.error));
    }
    await recordRateEvent(ipKey, 'reset');
    const userRow = await queryOne<{ id: string; email: string; display_name: string }>(
      'SELECT id, email, display_name FROM users WHERE LOWER(email) = $1',
      [parsed.data.email.toLowerCase()]
    );

    let previewUrl: string | undefined;
    if (userRow) {
      const token = crypto.randomBytes(24).toString('hex');
      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      await withTransaction(async (tx) => {
        await tx.executeSql(
          "UPDATE email_tokens SET used_at = $1 WHERE user_id = $2 AND kind = 'reset_password' AND used_at IS NULL",
          [nowIso, userRow.id]
        );
        await tx.executeSql(
          'INSERT INTO email_tokens (token, user_id, kind, new_email, expires_at, created_at) VALUES ($1, $2, $3, NULL, $4, $5)',
          [token, userRow.id, 'reset_password', expiresAt, nowIso]
        );
      });
      const resetUrl = `${resolveAppOrigin(req)}/reset-password?token=${token}`;
      const mailResult = await dispatchEmail({
        to: userRow.email,
        subject: `Reset your ${APP_NAME} password`,
        text: `Hello ${userRow.display_name}, use the link below within 1 hour to set a new password.`,
        actionUrl: resetUrl,
        recordOutbox: recordOutboxEmail,
      });
      if (process.env.NODE_ENV !== 'production') {
        previewUrl = mailResult.previewUrl;
      }
    }

    res.json({
      ok: true,
      message: 'If an account matches that address, reset instructions have been sent.',
      ...(previewUrl ? { preview_url: previewUrl } : {}),
    });
  })
);

apiRouter.post(
  '/auth/reset-password/confirm',
  asyncHandler(async (req, res) => {
    const ipKey = getClientIpKey(req);
    if (!(await checkRateLimit(ipKey, 'reset', 15, 3600_000))) {
      return sendError(res, 429, 'RATE_LIMITED', 'Too many reset attempts. Please try again later.');
    }
    const parsed = confirmResetSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Check your reset token and new password.', zodErrorToFields(parsed.error));
    }
    await recordRateEvent(ipKey, 'reset');
    const row = await queryOne<{ token: string; user_id: string; expires_at: string; used_at: string | null }>(
      "SELECT token, user_id, expires_at, used_at FROM email_tokens WHERE token = $1 AND kind = 'reset_password'",
      [parsed.data.token]
    );
    if (!row || row.used_at || Date.now() > new Date(row.expires_at).getTime()) {
      return sendError(res, 400, 'INVALID_TOKEN', 'This reset token is invalid or has expired.');
    }
    const { hash, salt } = hashPassword(parsed.data.password);
    const nowIso = new Date().toISOString();
    await withTransaction(async (tx) => {
      await tx.executeSql('UPDATE users SET password_hash = $1, salt = $2 WHERE id = $3', [hash, salt, row.user_id]);
      await tx.executeSql('UPDATE email_tokens SET used_at = $1 WHERE token = $2', [nowIso, parsed.data.token]);
    });
    res.json({ ok: true, message: 'Password updated. You can now sign in with your new password.' });
  })
);

// --- IMAGE UPLOADS, FALLBACK ASSETS & PROCEDURAL COVERS / OG ---
apiRouter.post(
  '/uploads',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to upload images.');
    }
    if (!(await checkRateLimit(viewer.id, 'upload', 20, 3600_000))) {
      return sendError(res, 429, 'RATE_LIMITED', 'Hourly upload limit reached (20 images/hour).');
    }
    const dataUrl = String(req.body?.dataUrl || '');
    if (!dataUrl) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Missing image data.');
    }
    try {
      const result = await saveUploadedImage(dataUrl, saveFallbackUploadedAsset);
      await recordRateEvent(viewer.id, 'upload');
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof StorageConfigError) {
        return sendError(res, 503, err.code, err.message);
      }
      return sendError(res, 400, 'INVALID_IMAGE', err instanceof Error ? err.message : 'Unable to save image.');
    }
  })
);

apiRouter.get(
  '/assets/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!id) return sendError(res, 404, 'NOT_FOUND', 'Asset not found.');
    const asset = await getFallbackUploadedAsset(id);
    if (!asset) return sendError(res, 404, 'NOT_FOUND', 'Asset not found.');
    const buf = Buffer.from(asset.data_base64, 'base64');
    res.setHeader('Content-Type', asset.mime_type);
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buf);
  })
);

apiRouter.get(
  '/covers/:slug.svg',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug || '');
    const row = await queryOne<{ title: string; type: 'experiment' | 'riddle'; category_ids_json: string }>(
      'SELECT title, type, category_ids_json FROM posts WHERE slug = $1',
      [slug]
    );
    const cats = row ? (JSON.parse(row.category_ids_json) as string[]) : [];
    const svg = renderProceduralCoverSvg({
      slug,
      title: row?.title || slug,
      categoryId: cats[0],
      kind: row?.type || 'experiment',
      isOg: false,
    });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  })
);

apiRouter.get(
  '/og/:slug.svg',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug || '');
    const row = await queryOne<{ title: string; type: 'experiment' | 'riddle'; category_ids_json: string }>(
      'SELECT title, type, category_ids_json FROM posts WHERE slug = $1',
      [slug]
    );
    const cats = row ? (JSON.parse(row.category_ids_json) as string[]) : [];
    const fallbackTitle =
      slug === 'strangetheory' ? 'Thought Experiments & Lateral Riddles' : APP_NAME;
    // CRITICAL SECURITY: OG SVG card never receives answer or explanation text.
    const svg = renderProceduralCoverSvg({
      slug,
      title: row?.title || fallbackTitle,
      categoryId: cats[0],
      kind: row?.type || 'experiment',
      isOg: true,
    });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  })
);

// --- CATEGORIES & BRAIN REGIONS ---
apiRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const published = await getAllPublishedPosts();
    const enriched = CATEGORIES.map((cat) => ({
      ...cat,
      post_count: published.filter((p) => p.category_ids.includes(cat.id)).length,
    }));
    res.json({ categories: enriched });
  })
);

// --- DAILY PICKS & RANDOM ---
apiRouter.get(
  '/daily',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);

    const snapshot = await queryOne<{ experiment_id: string | null; riddle_id: string | null }>(
      'SELECT experiment_id, riddle_id FROM daily_snapshots WHERE day_key = $1',
      [dayKey]
    );

    let dailyExp: Post | null = null;
    let dailyRiddle: Post | null = null;

    if (snapshot) {
      if (snapshot.experiment_id) {
        const exp = await getPostById(snapshot.experiment_id);
        if (exp && exp.status === 'published') dailyExp = exp;
      }
      if (snapshot.riddle_id) {
        const rid = await getPostById(snapshot.riddle_id);
        if (rid && rid.status === 'published') dailyRiddle = rid;
      }
    }

    if (!dailyExp || !dailyRiddle) {
      const all = (await getAllPublishedPosts()).sort((a, b) => a.id.localeCompare(b.id));
      const experiments = all.filter((p) => p.type === 'experiment');
      const riddles = all.filter((p) => p.type === 'riddle');
      const dayIndex = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400_000);
      if (!dailyExp) dailyExp = experiments.length ? experiments[dayIndex % experiments.length] : null;
      if (!dailyRiddle) dailyRiddle = riddles.length ? riddles[dayIndex % riddles.length] : null;
    }

    res.json({
      daily_experiment: dailyExp ? await enrichPost(dailyExp, viewer?.id || null) : null,
      daily_riddle: dailyRiddle ? await enrichPost(dailyRiddle, viewer?.id || null) : null,
    });
  })
);

apiRouter.get(
  '/random',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const published = await getAllPublishedPosts();
    if (published.length === 0) {
      return sendError(res, 404, 'EMPTY', 'No published posts found.');
    }
    const pick = published[Math.floor(Math.random() * published.length)];
    res.json({ post: await enrichPost(pick, viewer?.id || null) });
  })
);

// --- IDEA GRAPH (capped <= 150 nodes) ---
apiRouter.get(
  '/graph',
  asyncHandler(async (_req, res) => {
    const published = await getAllPublishedPosts();
    const nodes: Array<{
      id: string;
      kind: 'category' | 'experiment' | 'riddle';
      label: string;
      slug: string;
      color: string;
      weight: number;
    }> = [];
    const edges: Array<{ source: string; target: string }> = [];

    for (const cat of CATEGORIES) {
      nodes.push({
        id: cat.id,
        kind: 'category',
        label: `${cat.name} (${cat.brain_region})`,
        slug: cat.slug,
        color: cat.color,
        weight: 3,
      });
    }

    const maxPosts = Math.max(0, FOCUS_LIMITS.GRAPH_MAX_NODES - CATEGORIES.length);
    const topPosts = published
      .map((p) => ({
        post: p,
        score: p.counts.insights * 3 + p.counts.comments * 2 + p.counts.views * 0.1,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPosts)
      .map((x) => x.post);

    const postIdSet = new Set(topPosts.map((p) => p.id));

    for (const post of topPosts) {
      const primaryCat = CATEGORY_BY_ID.get(post.category_ids[0]);
      nodes.push({
        id: post.id,
        kind: post.type,
        label: post.title,
        slug: post.slug,
        color: primaryCat?.color || '#38BDF8',
        weight: 1 + Math.min(3, post.counts.insights * 0.2),
      });
      for (const cid of post.category_ids) {
        edges.push({ source: post.id, target: cid });
      }
      if (post.forked_from_id && postIdSet.has(post.forked_from_id)) {
        edges.push({ source: post.id, target: post.forked_from_id });
      }
    }

    res.json({ nodes, edges });
  })
);

// --- POSTS LIST, SEARCH, DETAIL, CRUD ---
apiRouter.get(
  '/posts',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const categoryQuery = String(req.query.category || '').trim();
    const typeFilter = String(req.query.type || 'all');
    const sort = String(req.query.sort || 'trending');
    const authorId = String(req.query.authorId || '').trim();
    const includeDrafts = req.query.includeDrafts === '1';
    const cursor = Math.max(0, Number(req.query.cursor || 0));
    const limit = Math.min(48, Math.max(1, Number(req.query.limit || FOCUS_LIMITS.EXPLORE_PAGE_SIZE)));

    const requestedSlugs = categoryQuery
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (requestedSlugs.length > FOCUS_LIMITS.MAX_ACTIVE_CATEGORIES) {
      return sendError(
        res,
        400,
        'TOO_MANY_FILTERS',
        `Select up to ${FOCUS_LIMITS.MAX_ACTIVE_CATEGORIES} brain-region categories at once.`
      );
    }

    const allRows = await query<Record<string, unknown>>('SELECT * FROM posts');
    let items = allRows.map(rowToPost).filter((p) => {
      if (includeDrafts && viewer && p.author_id === viewer.id) {
        return p.status !== 'hidden';
      }
      if (p.status !== 'published') return false;
      return true;
    });

    if (authorId) {
      items = items.filter((p) => p.author_id === authorId);
    }
    if (typeFilter === 'experiment' || typeFilter === 'riddle') {
      items = items.filter((p) => p.type === typeFilter);
    }
    if (requestedSlugs.length > 0) {
      const targetIds = requestedSlugs
        .map((slug) => CATEGORY_BY_SLUG.get(slug)?.id || (CATEGORY_BY_ID.has(slug) ? slug : null))
        .filter((id): id is string => Boolean(id));
      if (targetIds.length > 0) {
        items = items.filter((p) => targetIds.some((tid) => p.category_ids.includes(tid)));
      }
    }

    const enriched = await Promise.all(items.map((p) => enrichPost(p, viewer?.id || null)));

    if (sort === 'newest') {
      enriched.sort(
        (a, b) => new Date(b.published_at || b.created_at).getTime() - new Date(a.published_at || a.created_at).getTime()
      );
    } else if (sort === 'discussed') {
      enriched.sort((a, b) => b.counts.comments - a.counts.comments || b.counts.insights - a.counts.insights);
    } else {
      enriched.sort((a, b) => b.trending_score - a.trending_score);
    }

    const page = enriched.slice(cursor, cursor + limit);
    const next_cursor = cursor + limit < enriched.length ? cursor + limit : null;
    res.json({ items: page, next_cursor, total: enriched.length });
  })
);

apiRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const q = String(req.query.q || '').trim().toLowerCase();
    const typeFilter = String(req.query.type || 'all');
    const categorySlug = String(req.query.category || '').trim();
    const sort = String(req.query.sort || 'relevance');

    if (!q) {
      return res.json({ items: [], total: 0 });
    }

    const authorMap = new Map<string, { display_name: string; username: string }>();
    const userRows = await query<{ id: string; display_name: string; username: string }>(
      'SELECT id, display_name, username FROM users'
    );
    for (const u of userRows) {
      authorMap.set(u.id, { display_name: u.display_name.toLowerCase(), username: u.username.toLowerCase() });
    }

    const catFilterId = categorySlug ? CATEGORY_BY_SLUG.get(categorySlug)?.id || null : null;
    const published = await getAllPublishedPosts();

    const filtered = published.filter((p) => {
      if (typeFilter === 'experiment' || typeFilter === 'riddle') {
        if (p.type !== typeFilter) return false;
      }
      if (catFilterId && !p.category_ids.includes(catFilterId)) return false;

      const authorInfo = authorMap.get(p.author_id);
      const haystack = [
        p.title,
        p.intro,
        p.body_json.premise || '',
        p.body_json.ripples || '',
        p.body_json.breaks_down || '',
        p.body_json.free_content || '',
        (p.body_json.tags || []).join(' '),
        authorInfo?.display_name || '',
        authorInfo?.username || '',
      ]
        .join(' ')
        .replace(/<[^>]*>/g, ' ')
        .toLowerCase();

      return haystack.includes(q);
    });

    const matched = await Promise.all(filtered.map((p) => enrichPost(p, viewer?.id || null)));

    if (sort === 'newest') {
      matched.sort(
        (a, b) => new Date(b.published_at || b.created_at).getTime() - new Date(a.published_at || a.created_at).getTime()
      );
    } else if (sort === 'discussed') {
      matched.sort((a, b) => b.counts.comments - a.counts.comments);
    } else {
      matched.sort((a, b) => {
        const aTitle = a.title.toLowerCase().includes(q) ? 1 : 0;
        const bTitle = b.title.toLowerCase().includes(q) ? 1 : 0;
        return bTitle - aTitle || b.trending_score - a.trending_score;
      });
    }

    res.json({ items: matched, total: matched.length });
  })
);

// --- FOR YOU PERSONALIZED FEED (MAX 6) ---
apiRouter.get(
  '/posts/for-you',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const published = await getAllPublishedPosts();
    if (!viewer) {
      const enriched = await Promise.all(published.map((p) => enrichPost(p, null)));
      enriched.sort((a, b) => b.trending_score - a.trending_score);
      return res.json({ items: enriched.slice(0, FOCUS_LIMITS.HOME_FOR_YOU), personalized: false });
    }

    const [readsRows, bmRows] = await Promise.all([
      query<{ post_id: string }>('SELECT post_id FROM reading_progress WHERE user_id = $1', [viewer.id]),
      query<{ post_id: string }>('SELECT post_id FROM bookmarks WHERE user_id = $1', [viewer.id]),
    ]);

    const readIds = new Set(readsRows.map((r) => r.post_id));
    const bmIds = new Set(bmRows.map((b) => b.post_id));
    const favCatWeights = new Map<string, number>();

    for (const cid of viewer.favorite_category_ids || []) {
      favCatWeights.set(cid, (favCatWeights.get(cid) || 0) + 6);
    }
    for (const post of published) {
      if (readIds.has(post.id) || bmIds.has(post.id)) {
        for (const cid of post.category_ids) {
          favCatWeights.set(cid, (favCatWeights.get(cid) || 0) + (bmIds.has(post.id) ? 4 : 2.5));
        }
      }
    }

    const enriched = await Promise.all(published.map((p) => enrichPost(p, viewer.id)));
    const ranked = enriched
      .map((post) => {
        const catAffinity = post.category_ids.reduce((sum, cid) => sum + (favCatWeights.get(cid) || 0), 0);
        const unseenBoost = readIds.has(post.id) ? -4 : 3;
        const score = catAffinity + unseenBoost + Math.min(5, post.trending_score * 0.4);
        return { post, score };
      })
      .sort((a, b) => b.score - a.score || b.post.trending_score - a.post.trending_score)
      .slice(0, FOCUS_LIMITS.HOME_FOR_YOU)
      .map((x) => x.post);

    res.json({ items: ranked, personalized: favCatWeights.size > 0 });
  })
);

apiRouter.get(
  '/posts/by-slug/:slug',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const row = await queryOne<Record<string, unknown>>('SELECT * FROM posts WHERE slug = $1', [req.params.slug]);
    if (!row) {
      return sendError(res, 404, 'NOT_FOUND', 'Post not found.');
    }
    const post = rowToPost(row);
    if (post.status === 'hidden' && viewer?.role !== 'moderator' && viewer?.role !== 'admin' && viewer?.id !== post.author_id) {
      return sendError(res, 404, 'HIDDEN', 'This entry has been hidden by moderation.');
    }
    if (post.status === 'draft' && viewer?.id !== post.author_id) {
      return sendError(res, 403, 'FORBIDDEN', 'This draft is private to its author.');
    }
    if (post.status === 'published') {
      const nowIso = new Date().toISOString();
      const viewerKey = viewer ? `u:${viewer.id}` : getClientIpKey(req);
      await executeSql('UPDATE posts SET views = views + 1 WHERE id = $1', [post.id]);
      post.counts.views += 1;
      await executeSql(
        `INSERT INTO post_views (post_id, viewer_key, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (post_id, viewer_key) DO NOTHING`,
        [post.id, viewerKey, nowIso]
      );
      if (viewer) {
        await executeSql(
          `INSERT INTO reading_progress (user_id, post_id, progress_pct, last_section, reads_count, first_read_at, last_read_at)
           VALUES ($1, $2, 10, 'premise', 1, $3, $3)
           ON CONFLICT (user_id, post_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
          [viewer.id, post.id, nowIso]
        );
        if (post.type === 'riddle') {
          await executeSql(
            `INSERT INTO riddle_attempts (user_id, post_id, hints_used, submitted_at, show_all, solved_at, started_at)
             VALUES ($1, $2, 0, NULL, 0, NULL, $3)
             ON CONFLICT (user_id, post_id) DO UPDATE SET started_at = COALESCE(riddle_attempts.started_at, excluded.started_at)`,
            [viewer.id, post.id, nowIso]
          );
        }
      }
    }
    res.json({ post: await enrichPost(post, viewer?.id || null) });
  })
);

apiRouter.post(
  '/posts/:id/progress',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to save reading progress.');
    }
    const post = await getPostById(req.params.id);
    if (!post || (post.status !== 'published' && post.author_id !== viewer.id)) {
      return sendError(res, 404, 'NOT_FOUND', 'Post not found.');
    }
    const parsed = readingProgressSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid reading progress payload.', zodErrorToFields(parsed.error));
    }
    const nowIso = new Date().toISOString();
    await executeSql(
      `INSERT INTO reading_progress (user_id, post_id, progress_pct, last_section, reads_count, first_read_at, last_read_at)
       VALUES ($1, $2, $3, $4, 1, $5, $5)
       ON CONFLICT (user_id, post_id) DO UPDATE SET
         progress_pct = GREATEST(reading_progress.progress_pct, excluded.progress_pct),
         last_section = CASE WHEN excluded.last_section != '' THEN excluded.last_section ELSE reading_progress.last_section END,
         last_read_at = excluded.last_read_at`,
      [viewer.id, post.id, parsed.data.progress_pct, sanitizePlainText(parsed.data.last_section || ''), nowIso]
    );
    const updated = await queryOne<{ progress_pct: number; last_section: string; last_read_at: string }>(
      'SELECT progress_pct, last_section, last_read_at FROM reading_progress WHERE user_id = $1 AND post_id = $2',
      [viewer.id, post.id]
    );
    res.json({ reading_progress: updated });
  })
);

apiRouter.get(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const post = await getPostById(req.params.id);
    if (!post) {
      return sendError(res, 404, 'NOT_FOUND', 'Post not found.');
    }
    if (post.status === 'draft' && viewer?.id !== post.author_id) {
      return sendError(res, 403, 'FORBIDDEN', 'This draft is private to its author.');
    }
    if (post.status === 'hidden' && viewer?.id !== post.author_id && viewer?.role !== 'moderator' && viewer?.role !== 'admin') {
      return sendError(res, 404, 'HIDDEN', 'This entry has been hidden.');
    }
    res.json({ post: await enrichPost(post, viewer?.id || null) });
  })
);

apiRouter.post(
  '/posts',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to create a post.');
    }
    const parsed = createPostSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Please review your post fields.', zodErrorToFields(parsed.error));
    }

    const data = parsed.data;
    for (const cid of data.category_ids) {
      if (!CATEGORY_BY_ID.has(cid)) {
        return sendError(res, 400, 'INVALID_CATEGORY', 'Selected category does not exist.');
      }
    }
    if (data.forked_from_id) {
      const parent = await getPostById(data.forked_from_id);
      if (!parent || parent.status !== 'published') {
        return sendError(res, 404, 'FORK_TARGET_NOT_FOUND', 'Parent thought experiment not found.');
      }
    }
    if (data.type === 'experiment' && !data.body_json) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Thought experiments require structured content blocks.');
    }
    if (data.type === 'riddle' && !data.riddle) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Riddles require difficulty, answer, and explanation.');
    }

    const baseSlug = slugifyTitle(data.title);
    let slug = baseSlug;
    let counter = 2;
    while (await queryOne('SELECT 1 FROM posts WHERE slug = $1', [slug])) {
      slug = `${baseSlug}-${counter++}`;
    }

    const nowIso = new Date().toISOString();
    const id = `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cleanBody = data.body_json
      ? {
          premise: sanitizeRichText(data.body_json.premise),
          ripples: sanitizeRichText(data.body_json.ripples),
          breaks_down: sanitizeRichText(data.body_json.breaks_down),
          free_content: sanitizeRichText(data.body_json.free_content || ''),
          tags: (data.body_json.tags || []).map(sanitizePlainText),
        }
      : {
          premise: sanitizeRichText(data.intro),
          ripples: '',
          breaks_down: '',
          free_content: '',
          tags: [],
        };

    const readingMinutes = calculateReadingTime(
      `${data.intro} ${cleanBody.premise} ${cleanBody.ripples} ${cleanBody.breaks_down} ${cleanBody.free_content || ''}`
    );
    const coverUrl = data.cover_url || `/api/covers/${slug}.svg`;

    await withTransaction(async (tx) => {
      await tx.executeSql(
        `INSERT INTO posts (
          id, author_id, type, title, slug, cover_url, intro, body_json,
          perspective, thinking_style, status, reading_minutes, ai_assisted, ai_disclosure,
          category_ids_json, forked_from_id, views, comments_count, insights_count, bookmarks_count,
          is_seed, published_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11, $12, $13, $14, $15, 0, 0, 0, 0, 0, NULL, $16, $17)`,
        [
          id,
          viewer.id,
          data.type,
          sanitizePlainText(data.title),
          slug,
          coverUrl,
          sanitizePlainText(data.intro).slice(0, FOCUS_LIMITS.MAX_INTRO_LENGTH),
          JSON.stringify(cleanBody),
          data.perspective,
          data.thinking_style,
          readingMinutes,
          data.ai_assisted ? 1 : 0,
          data.ai_disclosure ? sanitizePlainText(data.ai_disclosure) : null,
          JSON.stringify(data.category_ids),
          data.forked_from_id || null,
          nowIso,
          nowIso,
        ]
      );

      if (data.type === 'riddle' && data.riddle) {
        const revealDays = data.riddle.reveal_days || 7;
        await tx.executeSql(
          `INSERT INTO riddles (post_id, difficulty, riddle_type, hints_json, reveal_mode, reveal_at, revealed, accepted_comment_id)
           VALUES ($1, $2, $3, $4, $5, $6, 0, NULL)`,
          [
            id,
            data.riddle.difficulty,
            data.riddle.riddle_type,
            JSON.stringify(data.riddle.hints.map(sanitizePlainText)),
            data.riddle.reveal_mode || 'auto',
            new Date(Date.now() + revealDays * 86400_000).toISOString(),
          ]
        );
        await tx.executeSql(
          `INSERT INTO riddle_secrets (post_id, answer_text, answer_keywords_json, explanation)
           VALUES ($1, $2, $3, $4)`,
          [
            id,
            sanitizePlainText(data.riddle.answer_text),
            JSON.stringify(data.riddle.answer_keywords.map(sanitizePlainText)),
            sanitizeRichText(data.riddle.explanation),
          ]
        );
      }
    });

    const created = (await getPostById(id))!;
    res.status(201).json({ post: await enrichPost(created, viewer.id) });
  })
);

apiRouter.patch(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to edit posts.');
    }
    const post = await getPostById(req.params.id);
    if (!post) {
      return sendError(res, 404, 'NOT_FOUND', 'Post not found.');
    }
    if (post.status === 'draft' && post.author_id !== viewer.id) {
      return sendError(res, 403, 'FORBIDDEN', 'Drafts can only be edited by their author.');
    }
    if (post.author_id !== viewer.id && viewer.role !== 'admin') {
      return sendError(res, 403, 'FORBIDDEN', 'You can only edit your own posts.');
    }
    if (post.status === 'hidden' && viewer.role !== 'moderator' && viewer.role !== 'admin') {
      return sendError(res, 403, 'POST_HIDDEN_BY_MODERATION', 'Hidden entries cannot be edited unless restored by moderation.');
    }

    const parsed = updatePostSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Please review your edits.', zodErrorToFields(parsed.error));
    }
    const data = parsed.data;
    if (data.category_ids) {
      for (const cid of data.category_ids) {
        if (!CATEGORY_BY_ID.has(cid)) {
          return sendError(res, 400, 'INVALID_CATEGORY', 'Selected category does not exist.');
        }
      }
    }
    const nextTitle = data.title ? sanitizePlainText(data.title) : post.title;
    const nextIntro = data.intro ? sanitizePlainText(data.intro).slice(0, FOCUS_LIMITS.MAX_INTRO_LENGTH) : post.intro;
    const nextCover = data.cover_url !== undefined ? (data.cover_url || `/api/covers/${post.slug}.svg`) : post.cover_url;
    const nextPerspective = data.perspective || post.perspective;
    const nextStyle = data.thinking_style || post.thinking_style;
    const nextCats = data.category_ids || post.category_ids;
    const nextAiAssisted = data.ai_assisted !== undefined ? data.ai_assisted : post.ai_assisted;
    const nextAiDisclosure =
      data.ai_disclosure !== undefined ? (data.ai_disclosure ? sanitizePlainText(data.ai_disclosure) : null) : post.ai_disclosure;

    let nextBody = post.body_json;
    if (data.body_json) {
      nextBody = {
        premise: sanitizeRichText(data.body_json.premise),
        ripples: sanitizeRichText(data.body_json.ripples),
        breaks_down: sanitizeRichText(data.body_json.breaks_down),
        free_content: sanitizeRichText(data.body_json.free_content || ''),
        tags: (data.body_json.tags || []).map(sanitizePlainText),
      };
    }
    const readingMinutes = calculateReadingTime(
      `${nextIntro} ${nextBody.premise} ${nextBody.ripples} ${nextBody.breaks_down} ${nextBody.free_content || ''}`
    );

    await executeSql(
      `UPDATE posts SET
        title = $1, intro = $2, cover_url = $3, perspective = $4, thinking_style = $5,
        category_ids_json = $6, ai_assisted = $7, ai_disclosure = $8, body_json = $9,
        reading_minutes = $10, updated_at = $11
      WHERE id = $12`,
      [
        nextTitle,
        nextIntro,
        nextCover,
        nextPerspective,
        nextStyle,
        JSON.stringify(nextCats),
        nextAiAssisted ? 1 : 0,
        nextAiDisclosure,
        JSON.stringify(nextBody),
        readingMinutes,
        new Date().toISOString(),
        post.id,
      ]
    );

    if (post.type === 'riddle' && data.riddle) {
      const existingRiddle = await getRiddlePublic(post.id);
      const revealAt = existingRiddle?.reveal_at || new Date(Date.now() + (data.riddle.reveal_days || 7) * 86400_000).toISOString();
      await executeSql(
        'UPDATE riddles SET difficulty = $1, riddle_type = $2, hints_json = $3, reveal_mode = $4, reveal_at = $5 WHERE post_id = $6',
        [
          data.riddle.difficulty,
          data.riddle.riddle_type,
          JSON.stringify(data.riddle.hints.map(sanitizePlainText)),
          data.riddle.reveal_mode || 'auto',
          revealAt,
          post.id,
        ]
      );
      await executeSql(
        'UPDATE riddle_secrets SET answer_text = $1, answer_keywords_json = $2, explanation = $3 WHERE post_id = $4',
        [
          sanitizePlainText(data.riddle.answer_text),
          JSON.stringify(data.riddle.answer_keywords.map(sanitizePlainText)),
          sanitizeRichText(data.riddle.explanation),
          post.id,
        ]
      );
    }

    const updated = (await getPostById(post.id))!;
    res.json({ post: await enrichPost(updated, viewer.id) });
  })
);

apiRouter.post(
  '/posts/:id/publish',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to publish.');
    }
    if (!viewer.email_verified && viewer.role !== 'admin') {
      return sendError(
        res,
        403,
        'EMAIL_NOT_VERIFIED',
        'Verify your email address before publishing. You can resend the verification link from your studio banner or settings.'
      );
    }
    const post = await getPostById(req.params.id);
    if (!post) {
      return sendError(res, 404, 'NOT_FOUND', 'Post not found.');
    }
    if (post.author_id !== viewer.id && viewer.role !== 'admin') {
      return sendError(res, 403, 'FORBIDDEN', 'Only the author can publish this post.');
    }
    if (post.status === 'hidden' && viewer.role !== 'moderator' && viewer.role !== 'admin') {
      return sendError(
        res,
        403,
        'POST_HIDDEN_BY_MODERATION',
        'This entry was hidden by moderation. Submit an appeal rather than re-publishing.'
      );
    }

    if (isNewAccount(viewer)) {
      const bodyBlob = `${post.intro} ${post.body_json.premise} ${post.body_json.ripples} ${post.body_json.breaks_down}`;
      if (containsExternalLink(bodyBlob)) {
        return sendError(
          res,
          403,
          'NEW_ACCOUNT_LINK_RESTRICTED',
          'Accounts under 24 hours old cannot publish external links.'
        );
      }
    }

    const wasNeverPublished = !post.published_at;
    if (post.status !== 'published') {
      if (!(await checkRateLimit(viewer.id, 'publish', FOCUS_LIMITS.DAILY_PUBLISH_LIMIT, 24 * 3600_000))) {
        return sendError(
          res,
          429,
          'RATE_LIMITED',
          `Focus limit reached: maximum ${FOCUS_LIMITS.DAILY_PUBLISH_LIMIT} publishes per 24 hours.`
        );
      }
      await recordRateEvent(viewer.id, 'publish');
    }

    const nowIso = new Date().toISOString();
    const publishedAt = post.published_at || nowIso;
    const ensuredCover = post.cover_url || `/api/covers/${post.slug}.svg`;
    await executeSql(
      "UPDATE posts SET status = 'published', cover_url = $1, published_at = $2, updated_at = $3 WHERE id = $4",
      [ensuredCover, publishedAt, nowIso, post.id]
    );

    if (wasNeverPublished) {
      await awardSynapse(viewer.id, post.type === 'riddle' ? 'Published a riddle' : 'Published a thought experiment', 5, post.id);
      const followers = await query<{ follower_id: string }>(
        `SELECT f.follower_id FROM follows f
         JOIN users u ON u.id = f.follower_id
         WHERE f.followee_id = $1 AND u.daily_digest_enabled = 1`,
        [viewer.id]
      );

      const href = `/${post.type === 'riddle' ? 'riddle' : 'post'}/${post.slug}`;
      for (const f of followers) {
        await executeSql(
          `INSERT INTO notifications (id, user_id, kind, title, body, href, read_at, is_seed, created_at)
           VALUES ($1, $2, 'digest_post', $3, $4, $5, NULL, 0, $6)`,
          [
            `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            f.follower_id,
            `${viewer.display_name} published a new ${post.type}`,
            post.title,
            href,
            nowIso,
          ]
        );
      }
    }

    const updated = (await getPostById(post.id))!;
    res.json({ post: await enrichPost(updated, viewer.id) });
  })
);

apiRouter.delete(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
    }
    const post = await getPostById(req.params.id);
    if (!post) {
      return sendError(res, 404, 'NOT_FOUND', 'Post not found.');
    }
    if (post.author_id !== viewer.id && viewer.role !== 'admin') {
      return sendError(res, 403, 'FORBIDDEN', 'Only the author or an admin can delete this post.');
    }
    await withTransaction(async (tx) => {
      await tx.executeSql('DELETE FROM comments WHERE post_id = $1', [post.id]);
      await tx.executeSql('DELETE FROM riddles WHERE post_id = $1', [post.id]);
      await tx.executeSql('DELETE FROM riddle_secrets WHERE post_id = $1', [post.id]);
      await tx.executeSql('DELETE FROM riddle_attempts WHERE post_id = $1', [post.id]);
      await tx.executeSql('DELETE FROM bookmarks WHERE post_id = $1', [post.id]);
      await tx.executeSql("DELETE FROM reactions WHERE target_type = 'post' AND target_id = $1", [post.id]);
      await tx.executeSql('DELETE FROM mind_change_votes WHERE post_id = $1', [post.id]);
      await tx.executeSql('DELETE FROM reading_progress WHERE post_id = $1', [post.id]);
      await tx.executeSql('DELETE FROM post_views WHERE post_id = $1', [post.id]);
      await tx.executeSql('DELETE FROM collection_items WHERE post_id = $1', [post.id]);
      await tx.executeSql('DELETE FROM weekly_challenges WHERE post_id = $1', [post.id]);
      await tx.executeSql('DELETE FROM posts WHERE id = $1', [post.id]);
    });
    res.json({ ok: true });
  })
);

// --- MIND-CHANGE METER ---
apiRouter.put(
  '/posts/:id/mind-change',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to record your plausibility rating.');
    }
    const post = await getPostById(req.params.id);
    if (!post || post.type !== 'experiment' || post.status !== 'published') {
      return sendError(res, 404, 'NOT_FOUND', 'Thought experiment not found.');
    }
    const parsed = mindChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Score must be between 0 and 100.', zodErrorToFields(parsed.error));
    }
    const existing = await queryOne<{ before_score: number | null; after_score: number | null }>(
      'SELECT before_score, after_score FROM mind_change_votes WHERE user_id = $1 AND post_id = $2',
      [viewer.id, post.id]
    );

    const beforeScore = parsed.data.phase === 'before' ? parsed.data.score : existing?.before_score ?? null;
    const afterScore = parsed.data.phase === 'after' ? parsed.data.score : existing?.after_score ?? null;

    await executeSql(
      `INSERT INTO mind_change_votes (user_id, post_id, before_score, after_score, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(user_id, post_id) DO UPDATE SET
         before_score = excluded.before_score,
         after_score = excluded.after_score,
         updated_at = excluded.updated_at`,
      [viewer.id, post.id, beforeScore, afterScore, new Date().toISOString()]
    );

    const enriched = await enrichPost(post, viewer.id);
    res.json({ mind_change: enriched.mind_change });
  })
);

// --- THREE-LENS COMMENTS & RIDDLE ANSWERS ---
apiRouter.get(
  '/posts/:id/comments',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const post = await getPostById(req.params.id);
    if (!post) {
      return sendError(res, 404, 'NOT_FOUND', 'Post not found.');
    }
    if (post.status === 'draft' && viewer?.id !== post.author_id) {
      return sendError(res, 403, 'FORBIDDEN', 'Comments on private drafts are not accessible.');
    }
    if (post.status === 'hidden' && viewer?.id !== post.author_id && viewer?.role !== 'moderator' && viewer?.role !== 'admin') {
      return sendError(res, 404, 'HIDDEN', 'This entry has been hidden.');
    }
    const lens = String(req.query.lens || (post.type === 'riddle' ? 'answer' : 'ripples')) as CommentLens;
    const sort = String(req.query.sort || 'top');
    const cursor = Math.max(0, Number(req.query.cursor || 0));
    const limit = Math.min(20, Math.max(1, Number(req.query.limit || FOCUS_LIMITS.COMMENTS_PAGE_SIZE)));

    if (post.type === 'riddle' && lens === 'answer') {
      await syncRiddleAutoReveal(post.id);
      const riddle = await getRiddlePublic(post.id);
      const isAuthor = viewer?.id === post.author_id;
      const isMod = viewer?.role === 'moderator' || viewer?.role === 'admin';
      const attempt = viewer
        ? await queryOne<{ submitted_at: string | null; show_all: number }>(
            'SELECT submitted_at, show_all FROM riddle_attempts WHERE user_id = $1 AND post_id = $2',
            [viewer.id, post.id]
          )
        : null;
      const unlocked = Boolean(isAuthor || isMod || riddle?.revealed || attempt?.submitted_at || attempt?.show_all);
      if (!unlocked) {
        const countRow = await queryOne<{ cnt: number }>(
          "SELECT COUNT(*)::int AS cnt FROM comments WHERE post_id = $1 AND lens = 'answer' AND parent_id IS NULL AND status = 'visible'",
          [post.id]
        );
        return res.json({ items: [], locked: true, total: Number(countRow?.cnt || 0), next_cursor: null });
      }
    }

    const allRows = await query<Record<string, unknown>>(
      "SELECT * FROM comments WHERE post_id = $1 AND lens = $2 AND status = 'visible'",
      [post.id, lens]
    );
    const allComments = allRows.map(rowToComment);
    const isRiddleAuthor = Boolean(post.type === 'riddle' && viewer?.id === post.author_id);

    const topLevel = await Promise.all(
      allComments.filter((c) => !c.parent_id).map((c) => enrichComment(c, viewer?.id || null, isRiddleAuthor))
    );

    if (sort === 'newest') {
      topLevel.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (sort === 'insightful') {
      topLevel.sort(
        (a, b) =>
          (b.insights_total || 0) - (a.insights_total || 0) ||
          (b.upvotes || 0) - (a.upvotes || 0) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    } else {
      topLevel.sort(
        (a, b) =>
          Number(b.is_accepted) - Number(a.is_accepted) ||
          b.upvotes - a.upvotes ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    const sliced = await Promise.all(
      topLevel.slice(cursor, cursor + limit).map(async (parent) => {
        const replyModels = allComments
          .filter((r) => r.parent_id === parent.id)
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const replies = await Promise.all(replyModels.map((r) => enrichComment(r, viewer?.id || null, isRiddleAuthor)));
        return { ...parent, replies };
      })
    );

    const next_cursor = cursor + limit < topLevel.length ? cursor + limit : null;
    res.json({ items: sliced, locked: false, total: topLevel.length, next_cursor });
  })
);

apiRouter.post(
  '/posts/:id/comments',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to contribute to the discussion.');
    }
    const post = await getPostById(req.params.id);
    if (!post || post.status !== 'published') {
      return sendError(res, 404, 'NOT_FOUND', 'Post not found.');
    }

    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Review your comment text.', zodErrorToFields(parsed.error));
    }

    const hourlyLimit = isNewAccount(viewer) ? FOCUS_LIMITS.NEW_ACCOUNT_COMMENT_LIMIT : FOCUS_LIMITS.HOURLY_COMMENT_LIMIT;
    if (!(await checkRateLimit(viewer.id, 'comment', hourlyLimit, 3600_000))) {
      return sendError(
        res,
        429,
        'RATE_LIMITED',
        `Rate limit reached: maximum ${hourlyLimit} comments per hour for your account.`
      );
    }

    if (isNewAccount(viewer) && containsExternalLink(parsed.data.body)) {
      return sendError(
        res,
        403,
        'NEW_ACCOUNT_LINK_RESTRICTED',
        'New accounts (under 24 hours) cannot post external links.'
      );
    }

    let parentComment: ReturnType<typeof rowToComment> | null = null;
    if (parsed.data.parent_id) {
      const pRow = await queryOne<Record<string, unknown>>(
        "SELECT * FROM comments WHERE id = $1 AND post_id = $2 AND status = 'visible'",
        [parsed.data.parent_id, post.id]
      );
      if (!pRow) {
        return sendError(res, 404, 'PARENT_NOT_FOUND', 'Parent comment not found.');
      }
      parentComment = rowToComment(pRow);
      if (parentComment.lens !== parsed.data.lens) {
        return sendError(res, 400, 'LENS_MISMATCH', 'Reply lens must match parent comment section.');
      }
      if (parentComment.parent_id) {
        return sendError(res, 400, 'MAX_NESTING', 'Replies support one level of nesting.');
      }
    }

    await recordRateEvent(viewer.id, 'comment');
    const nowIso = new Date().toISOString();
    const commentId = `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let likelyCorrect = false;
    let unlocked = false;

    if (post.type === 'riddle' && parsed.data.lens === 'answer' && !parentComment) {
      const secret = await getRiddleSecret(post.id);
      if (secret) {
        likelyCorrect = isLikelyAnswerMatch(parsed.data.body, secret.answer_keywords);
      }
      await executeSql(
        `INSERT INTO riddle_attempts (user_id, post_id, hints_used, submitted_at, show_all, solved_at, started_at)
         VALUES ($1, $2, 0, $3, 1, NULL, $3)
         ON CONFLICT(user_id, post_id) DO UPDATE SET
           submitted_at = COALESCE(riddle_attempts.submitted_at, excluded.submitted_at),
           started_at = COALESCE(riddle_attempts.started_at, excluded.started_at),
           show_all = 1`,
        [viewer.id, post.id, nowIso]
      );
      unlocked = true;
    }

    await executeSql(
      `INSERT INTO comments (id, post_id, lens, parent_id, author_id, body, status, is_accepted, likely_correct, upvotes, is_seed, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'visible', 0, $7, 1, 0, $8)`,
      [
        commentId,
        post.id,
        parsed.data.lens,
        parentComment ? parentComment.id : null,
        viewer.id,
        sanitizePlainText(parsed.data.body),
        likelyCorrect ? 1 : 0,
        nowIso,
      ]
    );

    await executeSql('UPDATE posts SET comments_count = comments_count + 1 WHERE id = $1', [post.id]);

    // Auto-accept solution on curated editorial riddles when solver matches keywords (never exposes riddle_secret early)
    if (
      post.type === 'riddle' &&
      parsed.data.lens === 'answer' &&
      !parentComment &&
      post.author_id === 'user-editorial' &&
      likelyCorrect &&
      viewer.id !== post.author_id
    ) {
      const existingAttempt = await queryOne<{ hints_used: number; solved_at: string | null }>(
        'SELECT hints_used, solved_at FROM riddle_attempts WHERE user_id = $1 AND post_id = $2',
        [viewer.id, post.id]
      );
      const riddle = await getRiddlePublic(post.id);
      if (riddle && !existingAttempt?.solved_at) {
        const isFirstSolver = !riddle.accepted_comment_id;
        const hintsUsed = existingAttempt?.hints_used || 0;
        const pts = calculateRiddleSolvePoints(riddle.difficulty, hintsUsed, isFirstSolver);
        await executeSql('UPDATE comments SET is_accepted = 1 WHERE id = $1', [commentId]);
        if (isFirstSolver) {
          await executeSql('UPDATE riddles SET accepted_comment_id = $1 WHERE post_id = $2', [commentId, post.id]);
        }
        await executeSql(
          'UPDATE riddle_attempts SET solved_at = $1, points_awarded = $2, show_all = 1 WHERE user_id = $3 AND post_id = $4',
          [nowIso, pts, viewer.id, post.id]
        );
        await awardSynapse(
          viewer.id,
          `Solved ${riddle.difficulty} riddle${isFirstSolver ? ' (First Solver)' : ''}`,
          pts,
          post.id
        );
        await executeSql(
          `INSERT INTO notifications (id, user_id, kind, title, body, href, read_at, is_seed, created_at)
           VALUES ($1, $2, 'riddle_solved', $3, $4, $5, NULL, 0, $6)`,
          [
            `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            viewer.id,
            `Solved riddle (+${pts} Synapse)`,
            post.title,
            `/riddle/${post.slug}`,
            nowIso,
          ]
        );
        await executeSql(
          `INSERT INTO notifications (id, user_id, kind, title, body, href, read_at, is_seed, created_at)
           VALUES ($1, $2, 'authored_riddle_solved', $3, $4, $5, NULL, 0, $6)`,
          [
            `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            post.author_id,
            `${viewer.display_name} solved your riddle`,
            post.title,
            `/riddle/${post.slug}`,
            nowIso,
          ]
        );
      }
    }

    const existingPostCommentPtsRow = await queryOne<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM points_ledger WHERE user_id = $1 AND source_id = $2 AND reason LIKE 'Commented%'",
      [viewer.id, post.id]
    );
    if (Number(existingPostCommentPtsRow?.c || 0) === 0 && viewer.id !== post.author_id) {
      await awardSynapse(viewer.id, `Commented in ${parsed.data.lens.replace('_', ' ')}`, 2, post.id);
    }

    const targetNotifyUserId = parentComment ? parentComment.author_id : post.author_id;
    if (targetNotifyUserId && targetNotifyUserId !== viewer.id) {
      await executeSql(
        `INSERT INTO notifications (id, user_id, kind, title, body, href, read_at, is_seed, created_at)
         VALUES ($1, $2, 'reply', $3, $4, $5, NULL, 0, $6)`,
        [
          `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          targetNotifyUserId,
          parentComment
            ? `${viewer.display_name} replied to your note`
            : `${viewer.display_name} added a ${parsed.data.lens.replace('_', ' ')} response`,
          post.title,
          `/${post.type === 'riddle' ? 'riddle' : 'post'}/${post.slug}`,
          nowIso,
        ]
      );
    }

    const createdRow = (await queryOne<Record<string, unknown>>('SELECT * FROM comments WHERE id = $1', [commentId]))!;
    const enriched = await enrichComment(
      rowToComment(createdRow),
      viewer.id,
      post.type === 'riddle' && viewer.id === post.author_id
    );
    res.status(201).json({ comment: enriched, unlocked });
  })
);

// --- RIDDLE MECHANICS ---
apiRouter.post(
  '/riddles/:id/hint',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to reveal hints.');
    }
    const post = await getPostById(req.params.id);
    const riddle = await getRiddlePublic(req.params.id);
    if (!post || post.type !== 'riddle' || !riddle || (post.status !== 'published' && post.author_id !== viewer.id)) {
      return sendError(res, 404, 'NOT_FOUND', 'Riddle not found.');
    }
    const attempt = await queryOne<{ hints_used: number }>(
      'SELECT hints_used FROM riddle_attempts WHERE user_id = $1 AND post_id = $2',
      [viewer.id, post.id]
    );

    const currentHints = attempt?.hints_used || 0;
    const nextHints = Math.min(riddle.hints.length, currentHints + 1);
    const nowIso = new Date().toISOString();
    await executeSql(
      `INSERT INTO riddle_attempts (user_id, post_id, hints_used, submitted_at, show_all, solved_at, started_at)
       VALUES ($1, $2, $3, NULL, 0, NULL, $4)
       ON CONFLICT(user_id, post_id) DO UPDATE SET
         hints_used = excluded.hints_used,
         started_at = COALESCE(riddle_attempts.started_at, excluded.started_at)`,
      [viewer.id, post.id, nextHints, nowIso]
    );

    res.json({
      hints_used: nextHints,
      revealed_hints: riddle.hints.slice(0, nextHints),
    });
  })
);

apiRouter.post(
  '/riddles/:id/show-answers',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to reveal community answers.');
    }
    const post = await getPostById(req.params.id);
    if (!post || post.type !== 'riddle' || (post.status !== 'published' && post.author_id !== viewer.id)) {
      return sendError(res, 404, 'NOT_FOUND', 'Riddle not found.');
    }
    await executeSql(
      `INSERT INTO riddle_attempts (user_id, post_id, hints_used, submitted_at, show_all, solved_at)
       VALUES ($1, $2, 0, NULL, 1, NULL)
       ON CONFLICT(user_id, post_id) DO UPDATE SET show_all = 1`,
      [viewer.id, post.id]
    );
    res.json({ answers_unlocked: true });
  })
);

apiRouter.post(
  '/riddles/:id/accept/:commentId',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
    }
    const post = await getPostById(req.params.id);
    const riddle = await getRiddlePublic(req.params.id);
    if (!post || !riddle || post.type !== 'riddle') {
      return sendError(res, 404, 'NOT_FOUND', 'Riddle not found.');
    }
    if (post.author_id !== viewer.id && viewer.role !== 'admin') {
      return sendError(res, 403, 'FORBIDDEN', 'Only the riddle author can mark the accepted solution.');
    }

    const targetRow = await queryOne<Record<string, unknown>>(
      "SELECT * FROM comments WHERE id = $1 AND post_id = $2 AND lens = 'answer'",
      [req.params.commentId, post.id]
    );
    if (!targetRow) {
      return sendError(res, 404, 'NOT_FOUND', 'Answer comment not found.');
    }
    const target = rowToComment(targetRow);
    const isFirstSolver = !riddle.accepted_comment_id;

    await executeSql('UPDATE comments SET is_accepted = 0 WHERE post_id = $1', [post.id]);
    await executeSql('UPDATE comments SET is_accepted = 1 WHERE id = $1', [target.id]);
    await executeSql('UPDATE riddles SET accepted_comment_id = $1 WHERE post_id = $2', [target.id, post.id]);

    const attempt = await queryOne<{ hints_used: number; solved_at: string | null }>(
      'SELECT hints_used, solved_at FROM riddle_attempts WHERE user_id = $1 AND post_id = $2',
      [target.author_id, post.id]
    );

    if (!attempt?.solved_at && target.author_id !== post.author_id) {
      const hintsUsed = attempt?.hints_used || 0;
      const pts = calculateRiddleSolvePoints(riddle.difficulty, hintsUsed, isFirstSolver);
      const nowIso = new Date().toISOString();
      await executeSql(
        `INSERT INTO riddle_attempts (user_id, post_id, hints_used, submitted_at, show_all, solved_at, points_awarded, started_at)
         VALUES ($1, $2, $3, $4, 1, $5, $6, $4)
         ON CONFLICT(user_id, post_id) DO UPDATE SET
           solved_at = excluded.solved_at,
           points_awarded = excluded.points_awarded,
           show_all = 1`,
        [target.author_id, post.id, hintsUsed, nowIso, nowIso, pts]
      );

      await awardSynapse(
        target.author_id,
        `Solved ${riddle.difficulty} riddle${isFirstSolver ? ' (First Solver)' : ''}`,
        pts,
        post.id
      );
      await executeSql(
        `INSERT INTO notifications (id, user_id, kind, title, body, href, read_at, is_seed, created_at)
         VALUES ($1, $2, 'riddle_solved', $3, $4, $5, NULL, 0, $6)`,
        [
          `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          target.author_id,
          `Your answer was marked correct (+${pts} Synapse)`,
          post.title,
          `/riddle/${post.slug}`,
          nowIso,
        ]
      );

      const solverUser = await getUserById(target.author_id);
      await executeSql(
        `INSERT INTO notifications (id, user_id, kind, title, body, href, read_at, is_seed, created_at)
         VALUES ($1, $2, 'authored_riddle_solved', $3, $4, $5, NULL, 0, $6)`,
        [
          `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          post.author_id,
          `${solverUser?.display_name || 'A thinker'} solved your riddle`,
          post.title,
          `/riddle/${post.slug}`,
          nowIso,
        ]
      );
    }

    res.json({ post: await enrichPost(post, viewer.id) });
  })
);

apiRouter.post(
  '/riddles/:id/reveal',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
    }
    const post = await getPostById(req.params.id);
    const riddle = await getRiddlePublic(req.params.id);
    if (!post || !riddle) {
      return sendError(res, 404, 'NOT_FOUND', 'Riddle not found.');
    }
    if (post.author_id !== viewer.id && viewer.role !== 'admin') {
      return sendError(res, 403, 'FORBIDDEN', 'Only the author can reveal the official explanation early.');
    }
    await executeSql('UPDATE riddles SET revealed = 1 WHERE post_id = $1', [post.id]);
    await notifyRiddleAnswerersRevealed(post);
    res.json({ post: await enrichPost(post, viewer.id) });
  })
);

// --- REACTIONS (POSTS & COMMENTS), FOLLOWS, BOOKMARKS ---
apiRouter.put(
  '/reactions',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to react.');
    }
    const parsed = reactionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid reaction payload.');
    }
    const { target_type, target_id, kind } = parsed.data;

    let ownerId: string | null = null;
    let postIdForComment: string | null = null;

    if (target_type === 'post') {
      const post = await getPostById(target_id);
      if (!post || post.status !== 'published') return sendError(res, 404, 'NOT_FOUND', 'Post not found.');
      ownerId = post.author_id;
    } else {
      const cRow = await queryOne<{ author_id: string; post_id: string }>(
        "SELECT c.author_id, c.post_id FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = $1 AND c.status = 'visible' AND p.status = 'published'",
        [target_id]
      );
      if (!cRow) return sendError(res, 404, 'NOT_FOUND', 'Comment not found.');
      ownerId = cRow.author_id;
      postIdForComment = cRow.post_id;
    }

    if (ownerId === viewer.id) {
      return sendError(res, 403, 'SELF_REACTION', 'You cannot react to your own work.');
    }
    if (!(await checkRateLimit(viewer.id, 'reaction', FOCUS_LIMITS.HOURLY_REACTION_LIMIT, 3600_000))) {
      return sendError(res, 429, 'RATE_LIMITED', 'Hourly reaction limit reached.');
    }

    const exists = await queryOne(
      'SELECT 1 FROM reactions WHERE user_id = $1 AND target_type = $2 AND target_id = $3 AND kind = $4',
      [viewer.id, target_type, target_id, kind]
    );

    const positive = kind === 'mind_blown' || kind === 'strong_logic' || kind === 'changed_mind';

    if (exists) {
      await executeSql(
        'DELETE FROM reactions WHERE user_id = $1 AND target_type = $2 AND target_id = $3 AND kind = $4',
        [viewer.id, target_type, target_id, kind]
      );
      if (target_type === 'post') {
        await executeSql('UPDATE posts SET insights_count = GREATEST(0, insights_count - 1) WHERE id = $1', [target_id]);
      } else {
        await executeSql('UPDATE comments SET upvotes = GREATEST(0, upvotes - 1) WHERE id = $1', [target_id]);
      }
      if (positive && ownerId) {
        await awardSynapse(ownerId, `Insight reaction removed (${kind})`, -2, target_id);
      }
      const post = target_type === 'post' ? await getPostById(target_id) : postIdForComment ? await getPostById(postIdForComment) : null;
      return res.json({ active: false, post: post ? await enrichPost(post, viewer.id) : null });
    }

    await recordRateEvent(viewer.id, 'reaction');
    await executeSql(
      'INSERT INTO reactions (user_id, target_type, target_id, kind, created_at) VALUES ($1, $2, $3, $4, $5)',
      [viewer.id, target_type, target_id, kind, new Date().toISOString()]
    );

    if (target_type === 'post') {
      await executeSql('UPDATE posts SET insights_count = insights_count + 1 WHERE id = $1', [target_id]);
    } else {
      await executeSql('UPDATE comments SET upvotes = upvotes + 1 WHERE id = $1', [target_id]);
    }
    if (positive && ownerId) {
      await awardSynapse(ownerId, `Received ${kind.replace('_', ' ')} insight`, 2, target_id);
    }

    const post = target_type === 'post' ? await getPostById(target_id) : postIdForComment ? await getPostById(postIdForComment) : null;
    res.json({ active: true, post: post ? await enrichPost(post, viewer.id) : null });
  })
);

apiRouter.post(
  '/follow/:userId',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to follow thinkers.');
    }
    if (req.params.userId === viewer.id) {
      return sendError(res, 400, 'INVALID_TARGET', 'You cannot follow yourself.');
    }
    const targetUser = await getUserById(req.params.userId);
    if (!targetUser || targetUser.banned) {
      return sendError(res, 404, 'NOT_FOUND', 'Member not found.');
    }
    const exists = await queryOne('SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2', [
      viewer.id,
      req.params.userId,
    ]);
    if (exists) {
      await executeSql('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [viewer.id, req.params.userId]);
      return res.json({ following: false });
    }
    await executeSql('INSERT INTO follows (follower_id, followee_id, created_at) VALUES ($1, $2, $3)', [
      viewer.id,
      req.params.userId,
      new Date().toISOString(),
    ]);
    res.json({ following: true });
  })
);

apiRouter.post(
  '/bookmarks/:postId',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to save bookmarks.');
    }
    const post = await getPostById(req.params.postId);
    if (!post || post.status !== 'published') {
      return sendError(res, 404, 'NOT_FOUND', 'Post not found.');
    }
    const exists = await queryOne('SELECT 1 FROM bookmarks WHERE user_id = $1 AND post_id = $2', [viewer.id, post.id]);
    if (exists) {
      await executeSql('DELETE FROM bookmarks WHERE user_id = $1 AND post_id = $2', [viewer.id, post.id]);
      await executeSql('UPDATE posts SET bookmarks_count = GREATEST(0, bookmarks_count - 1) WHERE id = $1', [post.id]);
      const updated = (await getPostById(post.id))!;
      return res.json({ bookmarked: false, bookmarks_count: updated.counts.bookmarks });
    }
    await executeSql('INSERT INTO bookmarks (user_id, post_id, created_at) VALUES ($1, $2, $3)', [
      viewer.id,
      post.id,
      new Date().toISOString(),
    ]);
    await executeSql('UPDATE posts SET bookmarks_count = bookmarks_count + 1 WHERE id = $1', [post.id]);
    const updated = (await getPostById(post.id))!;
    res.json({ bookmarked: true, bookmarks_count: updated.counts.bookmarks });
  })
);

// --- THINKER SEARCH (Command Palette) & MY BRAIN & ONBOARDING ---
apiRouter.get(
  '/users/search',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ users: [] });
    const rows = await query<Record<string, unknown>>(
      'SELECT * FROM users WHERE banned = 0 ORDER BY synapse_total DESC'
    );
    const matched = rows
      .map((r) => rowToProfile(r, false))
      .filter(
        (u) =>
          u.username.toLowerCase().includes(q) ||
          u.display_name.toLowerCase().includes(q)
      )
      .slice(0, 8)
      .map((u) => ({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        avatar_url: u.avatar_url,
        synapse_total: u.synapse_total,
        role: u.role,
      }));
    res.json({ users: matched });
  })
);

apiRouter.get(
  '/my-brain',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      const emptyStats = {
        entries_read: 0,
        riddles_solved: 0,
        hints_used: 0,
        current_streak: 0,
        regions_explored: 0,
        total_regions: CATEGORIES.length,
        weekly_reads: 0,
        reading_goal_per_week: 3,
      };
      const zeroRegionActivity = CATEGORIES.map((c) => ({
        category_id: c.id,
        slug: c.slug,
        name: c.name,
        brain_region: c.brain_region,
        color: c.color,
        reads: 0,
        solves: 0,
        bookmarks: 0,
        score: 0,
        glow: 0,
      }));
      return res.json({
        signed_in: false,
        stats: emptyStats,
        region_activity: zeroRegionActivity,
        badges: computeBrainBadges({ regionActivity: {}, regionsExplored: 0, riddlesSolved: 0, streakDays: 0 }),
      });
    }

    const [readsRows, attemptRows, bmRows] = await Promise.all([
      query<{ post_id: string; category_ids_json: string; last_read_at: string }>(
        `SELECT rp.post_id, p.category_ids_json, rp.last_read_at
         FROM reading_progress rp
         JOIN posts p ON p.id = rp.post_id
         WHERE rp.user_id = $1 AND p.status = 'published'`,
        [viewer.id]
      ),
      query<{ post_id: string; hints_used: number; solved_at: string | null; category_ids_json: string }>(
        `SELECT ra.post_id, ra.hints_used, ra.solved_at, p.category_ids_json
         FROM riddle_attempts ra
         JOIN posts p ON p.id = ra.post_id
         WHERE ra.user_id = $1`,
        [viewer.id]
      ),
      query<{ post_id: string; category_ids_json: string }>(
        `SELECT b.post_id, p.category_ids_json
         FROM bookmarks b
         JOIN posts p ON p.id = b.post_id
         WHERE b.user_id = $1 AND p.status = 'published'`,
        [viewer.id]
      ),
    ]);

    const readsMap = new Map<string, number>();
    const solvesMap = new Map<string, number>();
    const bookmarksMap = new Map<string, number>();
    const uniqueEntriesPerRegion = new Map<string, Set<string>>();
    const activityDates: string[] = [];

    const weekStartIso = (await getOrCreateWeeklyChallenge()).startsAt;
    let weeklyReads = 0;

    for (const r of readsRows) {
      activityDates.push(r.last_read_at);
      if (r.last_read_at >= weekStartIso) weeklyReads += 1;
      const cats = JSON.parse(r.category_ids_json || '[]') as string[];
      for (const cid of cats) {
        readsMap.set(cid, (readsMap.get(cid) || 0) + 1);
        if (!uniqueEntriesPerRegion.has(cid)) uniqueEntriesPerRegion.set(cid, new Set());
        uniqueEntriesPerRegion.get(cid)!.add(r.post_id);
      }
    }

    let riddlesSolved = 0;
    let hintsUsed = 0;
    for (const a of attemptRows) {
      hintsUsed += Number(a.hints_used || 0);
      if (a.solved_at) {
        riddlesSolved += 1;
        activityDates.push(a.solved_at);
        const cats = JSON.parse(a.category_ids_json || '[]') as string[];
        for (const cid of cats) {
          solvesMap.set(cid, (solvesMap.get(cid) || 0) + 1);
          if (!uniqueEntriesPerRegion.has(cid)) uniqueEntriesPerRegion.set(cid, new Set());
          uniqueEntriesPerRegion.get(cid)!.add(a.post_id);
        }
      }
    }

    for (const b of bmRows) {
      const cats = JSON.parse(b.category_ids_json || '[]') as string[];
      for (const cid of cats) {
        bookmarksMap.set(cid, (bookmarksMap.get(cid) || 0) + 1);
      }
    }

    const rawRegions = CATEGORIES.map((c) => {
      const reads = readsMap.get(c.id) || 0;
      const solves = solvesMap.get(c.id) || 0;
      const bookmarks = bookmarksMap.get(c.id) || 0;
      const score = reads + solves * 2 + bookmarks;
      return {
        category_id: c.id,
        slug: c.slug,
        name: c.name,
        brain_region: c.brain_region,
        color: c.color,
        reads,
        solves,
        bookmarks,
        score,
      };
    });

    const maxScore = Math.max(0, ...rawRegions.map((r) => r.score));
    const region_activity = rawRegions.map((r) => ({
      ...r,
      glow: r.score === 0 || maxScore === 0 ? 0 : Math.max(0.22, Number((r.score / maxScore).toFixed(3))),
    }));

    const regionsExplored = region_activity.filter((r) => r.score > 0).length;
    const currentStreak = calculateCurrentStreakDays(activityDates);
    const regionEntryCountObj: Record<string, number> = {};
    for (const [cid, set] of uniqueEntriesPerRegion.entries()) {
      regionEntryCountObj[cid] = set.size;
    }

    const badges = computeBrainBadges({
      regionActivity: regionEntryCountObj,
      regionsExplored,
      riddlesSolved,
      streakDays: currentStreak,
    });

    const data: MyBrainData = {
      stats: {
        entries_read: readsRows.length,
        riddles_solved: riddlesSolved,
        hints_used: hintsUsed,
        current_streak: currentStreak,
        regions_explored: regionsExplored,
        total_regions: CATEGORIES.length,
        weekly_reads: weeklyReads,
        reading_goal_per_week: viewer.reading_goal_per_week || 3,
      },
      region_activity,
      badges,
    };
    res.json({ signed_in: true, ...data });
  })
);

apiRouter.post(
  '/onboarding',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to save onboarding preferences.');
    }
    const parsed = onboardingSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Check your onboarding choices.', zodErrorToFields(parsed.error));
    }

    const validIds = parsed.data.favorite_category_ids.filter((id) => CATEGORY_BY_ID.has(id)).slice(0, 3);
    const nextInterests =
      viewer.interests.length > 0
        ? viewer.interests
        : validIds.map((id) => CATEGORY_BY_ID.get(id)!.name);
    const nextWeeklyDigest =
      parsed.data.weekly_digest_enabled !== undefined
        ? parsed.data.weekly_digest_enabled
        : viewer.weekly_digest_enabled || false;

    await executeSql(
      `UPDATE users
       SET onboarding_completed = 1,
           favorite_category_ids_json = $1,
           reading_goal_per_week = $2,
           weekly_digest_enabled = $3,
           interests_json = $4
       WHERE id = $5`,
      [
        JSON.stringify(validIds),
        parsed.data.reading_goal_per_week,
        nextWeeklyDigest ? 1 : 0,
        JSON.stringify(nextInterests),
        viewer.id,
      ]
    );

    res.json({ ok: true, user: await getUserById(viewer.id, true) });
  })
);

// --- PROFILES, SETTINGS, EXPORT, LEADERBOARD ---
apiRouter.get(
  '/users/:username',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const row = await queryOne<Record<string, unknown>>('SELECT * FROM users WHERE LOWER(username) = $1', [
      String(req.params.username).toLowerCase(),
    ]);
    if (!row) {
      return sendError(res, 404, 'NOT_FOUND', 'Thinker profile not found.');
    }
    const isOwner = viewer?.id === String(row.id);
    const profile = rowToProfile(row, isOwner);

    const userPostRows = await query<Record<string, unknown>>(
      'SELECT * FROM posts WHERE author_id = $1 ORDER BY COALESCE(published_at, created_at) DESC',
      [profile.id]
    );
    const allUserPosts = userPostRows.map(rowToPost);

    const published = await Promise.all(
      allUserPosts.filter((p) => p.status === 'published').map((p) => enrichPost(p, viewer?.id || null))
    );
    const drafts = isOwner
      ? await Promise.all(allUserPosts.filter((p) => p.status === 'draft').map((p) => enrichPost(p, viewer?.id || null)))
      : [];

    let bookmarks: EnrichedPost[] = [];
    if (isOwner) {
      const bmRows = await query<Record<string, unknown>>(
        `SELECT p.* FROM posts p
         JOIN bookmarks b ON b.post_id = p.id
         WHERE b.user_id = $1 AND p.status = 'published'
         ORDER BY b.created_at DESC`,
        [profile.id]
      );
      bookmarks = await Promise.all(bmRows.map((r) => enrichPost(rowToPost(r), viewer?.id || null)));
    }

    const [followersRow, followingRow, followCheck, synapseEvents] = await Promise.all([
      queryOne<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM follows WHERE followee_id = $1', [profile.id]),
      queryOne<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM follows WHERE follower_id = $1', [profile.id]),
      viewer
        ? queryOne('SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2', [viewer.id, profile.id])
        : Promise.resolve(null),
      query<SynapseEvent>(
        'SELECT id, user_id, reason, points, source_id, created_at FROM points_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 25',
        [profile.id]
      ),
    ]);

    res.json({
      profile,
      published,
      drafts,
      bookmarks,
      followers_count: Number(followersRow?.cnt || 0),
      following_count: Number(followingRow?.cnt || 0),
      is_following: Boolean(followCheck),
      synapse_events: synapseEvents,
    });
  })
);

apiRouter.patch(
  '/users/me',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
    }
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid profile updates.', zodErrorToFields(parsed.error));
    }
    const nextName = parsed.data.display_name ? sanitizePlainText(parsed.data.display_name) : viewer.display_name;
    const nextBio = parsed.data.bio !== undefined ? sanitizePlainText(parsed.data.bio) : viewer.bio;
    const nextInterests = parsed.data.interests !== undefined ? parsed.data.interests.map(sanitizePlainText) : viewer.interests;
    const nextAvatar = parsed.data.avatar_url !== undefined ? parsed.data.avatar_url : viewer.avatar_url;
    const nextDigest =
      parsed.data.daily_digest_enabled !== undefined ? parsed.data.daily_digest_enabled : viewer.daily_digest_enabled !== false;
    const nextWeeklyDigest =
      parsed.data.weekly_digest_enabled !== undefined ? parsed.data.weekly_digest_enabled : Boolean(viewer.weekly_digest_enabled);
    const nextGoal =
      parsed.data.reading_goal_per_week !== undefined ? parsed.data.reading_goal_per_week : viewer.reading_goal_per_week || 3;

    await executeSql(
      `UPDATE users
       SET display_name = $1, bio = $2, interests_json = $3, avatar_url = $4,
           daily_digest_enabled = $5, weekly_digest_enabled = $6, reading_goal_per_week = $7
       WHERE id = $8`,
      [nextName, nextBio, JSON.stringify(nextInterests), nextAvatar, nextDigest ? 1 : 0, nextWeeklyDigest ? 1 : 0, nextGoal, viewer.id]
    );

    res.json({ user: await getUserById(viewer.id, true) });
  })
);

apiRouter.post(
  '/users/me/email',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
    }
    const parsed = changeEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Check email and current password.', zodErrorToFields(parsed.error));
    }
    const userRow = (await queryOne<{ password_hash: string; salt: string }>(
      'SELECT password_hash, salt FROM users WHERE id = $1',
      [viewer.id]
    ))!;
    if (!verifyPassword(parsed.data.current_password, userRow.salt, userRow.password_hash)) {
      return sendError(res, 401, 'INVALID_PASSWORD', 'Current password is incorrect.');
    }
    const emailLower = parsed.data.email.toLowerCase();
    if (await queryOne('SELECT 1 FROM users WHERE LOWER(email) = $1 AND id != $2', [emailLower, viewer.id])) {
      return sendError(res, 409, 'EMAIL_EXISTS', 'That email address is already in use.');
    }

    const token = crypto.randomBytes(24).toString('hex');
    const nowIso = new Date().toISOString();
    await withTransaction(async (tx) => {
      await tx.executeSql('UPDATE users SET email = $1, email_verified = 0 WHERE id = $2', [emailLower, viewer.id]);
      await tx.executeSql(
        "UPDATE email_tokens SET used_at = $1 WHERE user_id = $2 AND kind = 'verify_email' AND used_at IS NULL",
        [nowIso, viewer.id]
      );
      await tx.executeSql(
        'INSERT INTO email_tokens (token, user_id, kind, new_email, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [token, viewer.id, 'verify_email', emailLower, new Date(Date.now() + 24 * 3600_000).toISOString(), nowIso]
      );
    });

    const verifyUrl = `${resolveAppOrigin(req)}/verify-email?token=${token}`;
    const mailResult = await dispatchEmail({
      to: emailLower,
      subject: `Verify your new ${APP_NAME} email`,
      text: `Confirm your updated email address for ${APP_NAME}.`,
      actionUrl: verifyUrl,
      recordOutbox: recordOutboxEmail,
    });

    const isProd = process.env.NODE_ENV === 'production';
    res.json({
      user: await getUserById(viewer.id, true),
      ...( !isProd && mailResult.previewUrl ? { preview_url: mailResult.previewUrl } : {} ),
    });
  })
);

apiRouter.post(
  '/users/me/password',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
    }
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Check password fields.', zodErrorToFields(parsed.error));
    }
    const userRow = (await queryOne<{ password_hash: string; salt: string }>(
      'SELECT password_hash, salt FROM users WHERE id = $1',
      [viewer.id]
    ))!;
    if (!verifyPassword(parsed.data.current_password, userRow.salt, userRow.password_hash)) {
      return sendError(res, 401, 'INVALID_PASSWORD', 'Current password is incorrect.');
    }
    const nextPw = hashPassword(parsed.data.new_password);
    await executeSql('UPDATE users SET password_hash = $1, salt = $2 WHERE id = $3', [nextPw.hash, nextPw.salt, viewer.id]);
    res.json({ ok: true, message: 'Password updated successfully.' });
  })
);

apiRouter.get(
  '/users/me/export',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
    }
    const [postRows, commentRows, bookmarks, reactions, mindChangeVotes, synapseLedger, progressRows, collectionRows] =
      await Promise.all([
        query<Record<string, unknown>>('SELECT * FROM posts WHERE author_id = $1', [viewer.id]),
        query<Record<string, unknown>>('SELECT * FROM comments WHERE author_id = $1', [viewer.id]),
        query('SELECT post_id, created_at FROM bookmarks WHERE user_id = $1', [viewer.id]),
        query('SELECT target_type, target_id, kind, created_at FROM reactions WHERE user_id = $1', [viewer.id]),
        query('SELECT post_id, before_score, after_score, updated_at FROM mind_change_votes WHERE user_id = $1', [viewer.id]),
        query('SELECT id, reason, points, source_id, created_at FROM points_ledger WHERE user_id = $1', [viewer.id]),
        query('SELECT post_id, progress_pct, last_section, last_read_at FROM reading_progress WHERE user_id = $1', [viewer.id]),
        query('SELECT id, title, slug, note, is_public, created_at FROM collections WHERE owner_id = $1', [viewer.id]),
      ]);
    const payload = {
      exported_at: new Date().toISOString(),
      app: APP_NAME,
      profile: viewer,
      posts: postRows.map(rowToPost),
      comments: commentRows.map(rowToComment),
      bookmarks,
      reactions,
      mind_change_votes: mindChangeVotes,
      synapse_ledger: synapseLedger,
      reading_progress: progressRows,
      collections: collectionRows,
    };
    res.setHeader('Content-Disposition', `attachment; filename="strangetheory-${viewer.username}-export.json"`);
    res.json(payload);
  })
);

apiRouter.delete(
  '/users/me',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
    }
    await withTransaction(async (tx) => {
      const ownedPostRows = await tx.query<{ id: string }>('SELECT id FROM posts WHERE author_id = $1', [viewer.id]);
      for (const { id: pid } of ownedPostRows) {
        await tx.executeSql('DELETE FROM comments WHERE post_id = $1', [pid]);
        await tx.executeSql('DELETE FROM riddles WHERE post_id = $1', [pid]);
        await tx.executeSql('DELETE FROM riddle_secrets WHERE post_id = $1', [pid]);
        await tx.executeSql('DELETE FROM riddle_attempts WHERE post_id = $1', [pid]);
        await tx.executeSql('DELETE FROM bookmarks WHERE post_id = $1', [pid]);
        await tx.executeSql("DELETE FROM reactions WHERE target_type = 'post' AND target_id = $1", [pid]);
        await tx.executeSql('DELETE FROM mind_change_votes WHERE post_id = $1', [pid]);
        await tx.executeSql('DELETE FROM reading_progress WHERE post_id = $1', [pid]);
        await tx.executeSql('DELETE FROM post_views WHERE post_id = $1', [pid]);
        await tx.executeSql('DELETE FROM collection_items WHERE post_id = $1', [pid]);
        await tx.executeSql('DELETE FROM weekly_challenges WHERE post_id = $1', [pid]);
      }
      const ownedCols = await tx.query<{ id: string }>('SELECT id FROM collections WHERE owner_id = $1', [viewer.id]);
      for (const { id: cid } of ownedCols) {
        await tx.executeSql('DELETE FROM collection_items WHERE collection_id = $1', [cid]);
      }
      await tx.executeSql('DELETE FROM collections WHERE owner_id = $1', [viewer.id]);
      await tx.executeSql('DELETE FROM reading_progress WHERE user_id = $1', [viewer.id]);
      await tx.executeSql('DELETE FROM posts WHERE author_id = $1', [viewer.id]);
      await tx.executeSql('DELETE FROM comments WHERE author_id = $1', [viewer.id]);
      await tx.executeSql('DELETE FROM bookmarks WHERE user_id = $1', [viewer.id]);
      await tx.executeSql('DELETE FROM reactions WHERE user_id = $1', [viewer.id]);
      await tx.executeSql('DELETE FROM follows WHERE follower_id = $1 OR followee_id = $2', [viewer.id, viewer.id]);
      await tx.executeSql('DELETE FROM notifications WHERE user_id = $1', [viewer.id]);
      await tx.executeSql('DELETE FROM points_ledger WHERE user_id = $1', [viewer.id]);
      await tx.executeSql('DELETE FROM mind_change_votes WHERE user_id = $1', [viewer.id]);
      await tx.executeSql('DELETE FROM riddle_attempts WHERE user_id = $1', [viewer.id]);
      await tx.executeSql('DELETE FROM email_tokens WHERE user_id = $1', [viewer.id]);
      await tx.executeSql('DELETE FROM users WHERE id = $1', [viewer.id]);
    });
    clearSessionCookie(res, req);
    res.json({ ok: true });
  })
);

apiRouter.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const windowParam = String(req.query.window || 'all');
    const windowKey: 'week' | 'month' | 'all' =
      windowParam === 'week' || windowParam === 'month' ? windowParam : 'all';

    const [users, ledger, postCounts, solvedCounts] = await Promise.all([
      query<Record<string, unknown>>('SELECT * FROM users WHERE banned = 0'),
      query<SynapseEvent>('SELECT * FROM points_ledger'),
      query<{ author_id: string; cnt: number }>(
        "SELECT author_id, COUNT(*)::int AS cnt FROM posts WHERE status = 'published' GROUP BY author_id"
      ),
      query<{ user_id: string; cnt: number }>(
        'SELECT user_id, COUNT(*)::int AS cnt FROM riddle_attempts WHERE solved_at IS NOT NULL GROUP BY user_id'
      ),
    ]);

    const postCountMap = new Map(postCounts.map((r) => [r.author_id, Number(r.cnt)]));
    const solvedCountMap = new Map(solvedCounts.map((r) => [r.user_id, Number(r.cnt)]));
    const scoreMap = sumPointsInWindow(ledger, windowKey);

    const leaders = users
      .map((u) => {
        const profile = rowToProfile(u, false);
        const posts_count = postCountMap.get(profile.id) || 0;
        const riddles_solved = solvedCountMap.get(profile.id) || 0;
        const windowPoints = windowKey === 'all' ? profile.synapse_total : Math.max(0, scoreMap.get(profile.id) || 0);
        return {
          id: profile.id,
          username: profile.username,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          role: profile.role,
          synapse_total: windowPoints,
          all_time_synapse: profile.synapse_total,
          badges: profile.badges,
          posts_count,
          riddles_solved,
        };
      })
      .sort((a, b) => b.synapse_total - a.synapse_total || b.posts_count - a.posts_count)
      .map((entry, idx) => ({ rank: idx + 1, ...entry }));

    res.json({ window: windowKey, leaders });
  })
);

// --- NOTIFICATIONS, WEEKLY DIGEST UNSUBSCRIBE, COLLECTIONS, DASHBOARD & WEEKLY CHALLENGE ---
async function getNotificationsHandler(req: Request, res: Response) {
  const viewer = await getViewer(req);
  if (!viewer) {
    return res.json({ items: [], unread_count: 0, daily_digest_enabled: true, weekly_digest_enabled: false });
  }
  const [items, unreadRow] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [viewer.id, FOCUS_LIMITS.NOTIFICATIONS_MAX]
    ),
    queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL', [
      viewer.id,
    ]),
  ]);
  res.json({
    items: items.map((n) => ({
      id: String(n.id),
      user_id: String(n.user_id),
      kind: String(n.kind),
      title: String(n.title),
      body: String(n.body),
      href: String(n.href),
      read_at: n.read_at ? String(n.read_at) : null,
      created_at: String(n.created_at),
    })),
    unread_count: Number(unreadRow?.c || 0),
    daily_digest_enabled: viewer.daily_digest_enabled !== false,
    weekly_digest_enabled: Boolean(viewer.weekly_digest_enabled),
  });
}

async function markNotificationsReadHandler(req: Request, res: Response) {
  const viewer = await getViewer(req);
  if (!viewer) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
  }
  await executeSql('UPDATE notifications SET read_at = $1 WHERE user_id = $2 AND read_at IS NULL', [
    new Date().toISOString(),
    viewer.id,
  ]);
  res.json({ ok: true });
}

apiRouter.get('/notifications', asyncHandler(getNotificationsHandler));
apiRouter.post('/notifications/read', asyncHandler(markNotificationsReadHandler));
apiRouter.get('/digest', asyncHandler(getNotificationsHandler));
apiRouter.post('/digest/read', asyncHandler(markNotificationsReadHandler));

apiRouter.get(
  '/digest/unsubscribe',
  asyncHandler(async (req, res) => {
    const token = String(req.query.token || '').trim();
    const userId = verifyWeeklyDigestUnsubscribeToken(token);
    if (!userId) {
      if (req.query.format === 'json' || (!req.accepts('html') && req.accepts('json'))) {
        return sendError(res, 400, 'INVALID_TOKEN', 'Invalid or expired unsubscribe token.');
      }
      return res.redirect('/digest/unsubscribed?status=invalid');
    }
    await executeSql('UPDATE users SET weekly_digest_enabled = 0 WHERE id = $1', [userId]);
    if (req.query.format === 'json' || (!req.accepts('html') && req.accepts('json'))) {
      return res.json({ ok: true, unsubscribed: true });
    }
    return res.redirect('/digest/unsubscribed?status=ok');
  })
);

// --- COLLECTIONS ---
apiRouter.get(
  '/collections',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const username = String(req.query.username || '').trim().toLowerCase();
    const postIdFilter = String(req.query.postId || '').trim();

    let targetOwnerId: string | null = null;
    let onlyPublic = false;

    if (username) {
      const targetUser = await queryOne<{ id: string }>('SELECT id FROM users WHERE LOWER(username) = $1', [username]);
      if (!targetUser) return res.json({ collections: [] });
      targetOwnerId = targetUser.id;
      onlyPublic = viewer?.id !== targetUser.id;
    } else if (viewer) {
      targetOwnerId = viewer.id;
      onlyPublic = false;
    } else {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to view your collections.');
    }

    const rows = await query<Record<string, unknown>>(
      `SELECT c.*, u.username AS owner_username, u.display_name AS owner_display_name,
              (SELECT COUNT(*)::int FROM collection_items ci JOIN posts p ON p.id = ci.post_id WHERE ci.collection_id = c.id AND p.status = 'published') AS item_count
       FROM collections c
       JOIN users u ON u.id = c.owner_id
       WHERE c.owner_id = $1 ${onlyPublic ? 'AND c.is_public = 1' : ''}
       ORDER BY c.updated_at DESC`,
      [targetOwnerId]
    );

    let postSet = new Set<string>();
    if (postIdFilter && rows.length > 0) {
      const matches = await query<{ collection_id: string }>(
        'SELECT collection_id FROM collection_items WHERE post_id = $1',
        [postIdFilter]
      );
      postSet = new Set(matches.map((m) => m.collection_id));
    }

    const collections: CollectionSummary[] = rows.map((r) => ({
      id: String(r.id),
      owner_id: String(r.owner_id),
      owner_username: String(r.owner_username || ''),
      owner_display_name: String(r.owner_display_name || ''),
      title: String(r.title),
      slug: String(r.slug),
      note: String(r.note || ''),
      is_public: Boolean(r.is_public),
      item_count: Number(r.item_count || 0),
      ...(postIdFilter ? { contains_post: postSet.has(String(r.id)) } : {}),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    }));

    res.json({ collections });
  })
);

apiRouter.get(
  '/collections/:idOrSlug',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const key = String(req.params.idOrSlug || '');
    const row = await queryOne<Record<string, unknown>>(
      `SELECT c.*, u.username AS owner_username, u.display_name AS owner_display_name
       FROM collections c
       JOIN users u ON u.id = c.owner_id
       WHERE c.id = $1 OR c.slug = $1`,
      [key]
    );
    if (!row) {
      return sendError(res, 404, 'NOT_FOUND', 'Collection not found.');
    }
    const isPublic = Boolean(row.is_public);
    if (!isPublic && viewer?.id !== String(row.owner_id)) {
      return sendError(res, 403, 'FORBIDDEN', 'This collection is private to its curator.');
    }

    const postRows = await query<Record<string, unknown>>(
      `SELECT p.* FROM posts p
       JOIN collection_items ci ON ci.post_id = p.id
       WHERE ci.collection_id = $1 AND p.status = 'published'
       ORDER BY ci.position ASC, ci.added_at DESC`,
      [String(row.id)]
    );
    const items = await Promise.all(postRows.map((p) => enrichPost(rowToPost(p), viewer?.id || null)));

    const detail: CollectionDetail = {
      id: String(row.id),
      owner_id: String(row.owner_id),
      owner_username: String(row.owner_username || ''),
      owner_display_name: String(row.owner_display_name || ''),
      title: String(row.title),
      slug: String(row.slug),
      note: String(row.note || ''),
      is_public: isPublic,
      item_count: items.length,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      items,
    };
    res.json({ collection: detail });
  })
);

apiRouter.post(
  '/collections',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to create collections.');
    }
    const parsed = createCollectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Check collection title and note.', zodErrorToFields(parsed.error));
    }
    const countRow = await queryOne<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM collections WHERE owner_id = $1', [
      viewer.id,
    ]);
    if (Number(countRow?.cnt || 0) >= FOCUS_LIMITS.MAX_COLLECTIONS_PER_USER) {
      return sendError(
        res,
        400,
        'COLLECTION_LIMIT',
        `Focus limit: you can maintain up to ${FOCUS_LIMITS.MAX_COLLECTIONS_PER_USER} collections.`
      );
    }

    const baseSlug = slugifyTitle(parsed.data.title);
    let slug = baseSlug;
    let counter = 2;
    while (await queryOne('SELECT 1 FROM collections WHERE slug = $1', [slug])) {
      slug = `${baseSlug}-${counter++}`;
    }

    const id = `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const cleanTitle = sanitizePlainText(parsed.data.title);
    const cleanNote = sanitizePlainText(parsed.data.note || '');
    await executeSql(
      `INSERT INTO collections (id, owner_id, title, slug, note, is_public, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, viewer.id, cleanTitle, slug, cleanNote, parsed.data.is_public ? 1 : 0, nowIso, nowIso]
    );

    const summary: CollectionSummary = {
      id,
      owner_id: viewer.id,
      owner_username: viewer.username,
      owner_display_name: viewer.display_name,
      title: cleanTitle,
      slug,
      note: cleanNote,
      is_public: Boolean(parsed.data.is_public),
      item_count: 0,
      created_at: nowIso,
      updated_at: nowIso,
    };
    res.status(201).json({ collection: summary });
  })
);

apiRouter.patch(
  '/collections/:id',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
    }
    const row = await queryOne<Record<string, unknown>>('SELECT * FROM collections WHERE id = $1', [req.params.id]);
    if (!row) return sendError(res, 404, 'NOT_FOUND', 'Collection not found.');
    if (String(row.owner_id) !== viewer.id) {
      return sendError(res, 403, 'FORBIDDEN', 'Only the owner can edit this collection.');
    }
    const parsed = updateCollectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid collection updates.', zodErrorToFields(parsed.error));
    }
    const nextTitle = parsed.data.title ? sanitizePlainText(parsed.data.title) : String(row.title);
    const nextNote = parsed.data.note !== undefined ? sanitizePlainText(parsed.data.note) : String(row.note || '');
    const nextPublic = parsed.data.is_public !== undefined ? parsed.data.is_public : Boolean(row.is_public);
    const nowIso = new Date().toISOString();

    await executeSql(
      'UPDATE collections SET title = $1, note = $2, is_public = $3, updated_at = $4 WHERE id = $5',
      [nextTitle, nextNote, nextPublic ? 1 : 0, nowIso, String(row.id)]
    );
    const countRow = await queryOne<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM collection_items WHERE collection_id = $1', [
      String(row.id),
    ]);
    res.json({
      collection: {
        id: String(row.id),
        owner_id: String(row.owner_id),
        owner_username: viewer.username,
        owner_display_name: viewer.display_name,
        title: nextTitle,
        slug: String(row.slug),
        note: nextNote,
        is_public: nextPublic,
        item_count: Number(countRow?.cnt || 0),
        created_at: String(row.created_at),
        updated_at: nowIso,
      },
    });
  })
);

apiRouter.delete(
  '/collections/:id',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
    }
    const row = await queryOne<{ id: string; owner_id: string }>('SELECT id, owner_id FROM collections WHERE id = $1', [
      req.params.id,
    ]);
    if (!row) return sendError(res, 404, 'NOT_FOUND', 'Collection not found.');
    if (row.owner_id !== viewer.id && viewer.role !== 'admin') {
      return sendError(res, 403, 'FORBIDDEN', 'Only the owner can delete this collection.');
    }
    await withTransaction(async (tx) => {
      await tx.executeSql('DELETE FROM collection_items WHERE collection_id = $1', [row.id]);
      await tx.executeSql('DELETE FROM collections WHERE id = $1', [row.id]);
    });
    res.json({ ok: true });
  })
);

apiRouter.post(
  '/collections/:id/items',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
    }
    const col = await queryOne<{ id: string; owner_id: string }>('SELECT id, owner_id FROM collections WHERE id = $1', [
      req.params.id,
    ]);
    if (!col) return sendError(res, 404, 'NOT_FOUND', 'Collection not found.');
    if (col.owner_id !== viewer.id) {
      return sendError(res, 403, 'FORBIDDEN', 'Only the owner can modify this collection.');
    }
    const postId = String(req.body?.post_id || '').trim();
    const post = postId ? await getPostById(postId) : null;
    if (!post || post.status !== 'published') {
      return sendError(res, 404, 'NOT_FOUND', 'Published entry not found.');
    }
    const countRow = await queryOne<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM collection_items WHERE collection_id = $1', [
      col.id,
    ]);
    const currentCount = Number(countRow?.cnt || 0);
    if (currentCount >= FOCUS_LIMITS.MAX_ITEMS_PER_COLLECTION) {
      return sendError(
        res,
        400,
        'COLLECTION_FULL',
        `Each collection supports up to ${FOCUS_LIMITS.MAX_ITEMS_PER_COLLECTION} entries.`
      );
    }
    const nowIso = new Date().toISOString();
    await executeSql(
      `INSERT INTO collection_items (collection_id, post_id, position, added_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (collection_id, post_id) DO NOTHING`,
      [col.id, post.id, currentCount, nowIso]
    );
    await executeSql('UPDATE collections SET updated_at = $1 WHERE id = $2', [nowIso, col.id]);
    const nextCount = await queryOne<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM collection_items WHERE collection_id = $1', [
      col.id,
    ]);
    res.status(201).json({ ok: true, item_count: Number(nextCount?.cnt || 0) });
  })
);

apiRouter.delete(
  '/collections/:id/items/:postId',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
    }
    const col = await queryOne<{ id: string; owner_id: string }>('SELECT id, owner_id FROM collections WHERE id = $1', [
      req.params.id,
    ]);
    if (!col) return sendError(res, 404, 'NOT_FOUND', 'Collection not found.');
    if (col.owner_id !== viewer.id) {
      return sendError(res, 403, 'FORBIDDEN', 'Only the owner can modify this collection.');
    }
    await executeSql('DELETE FROM collection_items WHERE collection_id = $1 AND post_id = $2', [col.id, req.params.postId]);
    await executeSql('UPDATE collections SET updated_at = $1 WHERE id = $2', [new Date().toISOString(), col.id]);
    const nextCount = await queryOne<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM collection_items WHERE collection_id = $1', [
      col.id,
    ]);
    res.json({ ok: true, item_count: Number(nextCount?.cnt || 0) });
  })
);

// --- AUTHOR DASHBOARD ---
apiRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to open your Author Dashboard.');
    }
    const postRows = await query<Record<string, unknown>>(
      "SELECT * FROM posts WHERE author_id = $1 AND status != 'hidden' ORDER BY COALESCE(published_at, created_at) DESC",
      [viewer.id]
    );
    const posts = postRows.map(rowToPost);

    const entries: AuthorDashboardEntry[] = await Promise.all(
      posts.map(async (p) => {
        const [viewRow, rxnRow, mcRows, cmtRow, attemptRows] = await Promise.all([
          queryOne<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM post_views WHERE post_id = $1', [p.id]),
          queryOne<{ cnt: number }>(
            "SELECT COUNT(*)::int AS cnt FROM reactions WHERE target_type = 'post' AND target_id = $1 AND kind IN ('mind_blown', 'strong_logic', 'changed_mind')",
            [p.id]
          ),
          p.type === 'experiment'
            ? query<{ before_score: number | null; after_score: number | null }>(
                'SELECT before_score, after_score FROM mind_change_votes WHERE post_id = $1',
                [p.id]
              )
            : Promise.resolve([]),
          queryOne<{ cnt: number }>("SELECT COUNT(*)::int AS cnt FROM comments WHERE post_id = $1 AND status = 'visible'", [
            p.id,
          ]),
          p.type === 'riddle'
            ? query<{ hints_used: number; submitted_at: string | null; solved_at: string | null }>(
                'SELECT hints_used, submitted_at, solved_at FROM riddle_attempts WHERE post_id = $1',
                [p.id]
              )
            : Promise.resolve([]),
        ]);

        const mcStats = p.type === 'experiment' ? calculateMindChangeStats(mcRows) : null;
        let solveRate: number | null = null;
        let avgHints: number | null = null;
        if (p.type === 'riddle') {
          const activeAttempts = attemptRows.filter((a) => a.submitted_at || a.solved_at || a.hints_used > 0);
          const solved = attemptRows.filter((a) => a.solved_at).length;
          solveRate = activeAttempts.length > 0 ? Math.round((solved / activeAttempts.length) * 100) : 0;
          avgHints =
            activeAttempts.length > 0
              ? Number((activeAttempts.reduce((acc, a) => acc + Number(a.hints_used || 0), 0) / activeAttempts.length).toFixed(1))
              : 0;
        }

        return {
          id: p.id,
          title: p.title,
          slug: p.slug,
          type: p.type,
          status: p.status,
          published_at: p.published_at,
          unique_views: Number(viewRow?.cnt || 0),
          insight_reactions: Number(rxnRow?.cnt || 0),
          avg_mind_shift: mcStats?.delta_avg ?? null,
          comments_count: Number(cmtRow?.cnt || 0),
          solve_rate: solveRate,
          avg_hints_used: avgHints,
        };
      })
    );

    res.json({ entries });
  })
);

// --- WEEKLY RIDDLE CHALLENGE ---
apiRouter.get(
  '/weekly-riddle',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    const challenge = await getOrCreateWeeklyChallenge();
    const post = challenge.postId ? await getPostById(challenge.postId) : null;
    const enrichedRiddle = post ? await enrichPost(post, viewer?.id || null) : null;

    let leaderboard: WeeklyChallengeData['leaderboard'] = [];
    let userRank: number | null = null;

    if (post) {
      const attemptRows = await query<{
        user_id: string;
        username: string;
        display_name: string;
        hints_used: number;
        started_at: string | null;
        submitted_at: string | null;
        solved_at: string;
      }>(
        `SELECT ra.user_id, u.username, u.display_name, ra.hints_used, ra.started_at, ra.submitted_at, ra.solved_at
         FROM riddle_attempts ra
         JOIN users u ON u.id = ra.user_id
         WHERE ra.post_id = $1 AND ra.solved_at IS NOT NULL AND ra.solved_at >= $2 AND u.banned = 0`,
        [post.id, challenge.startsAt]
      );

      const entries = attemptRows.map((row) => {
        const startMs = Date.parse(row.started_at || row.submitted_at || row.solved_at);
        const solvedMs = Date.parse(row.solved_at);
        const duration = Math.max(1, Math.round((solvedMs - startMs) / 1000));
        return {
          user_id: row.user_id,
          username: row.username,
          display_name: row.display_name,
          hints_used: Number(row.hints_used || 0),
          duration_seconds: Number.isFinite(duration) ? duration : 60,
          solved_at: row.solved_at,
        };
      });

      leaderboard = rankWeeklyChallengeEntries(entries);
      if (viewer) {
        const found = leaderboard.find((l) => l.user_id === viewer.id);
        userRank = found ? found.rank : null;
      }
    }

    const payload: WeeklyChallengeData = {
      week_key: challenge.weekKey,
      starts_at: challenge.startsAt,
      ends_at: challenge.endsAt,
      riddle: enrichedRiddle,
      leaderboard,
      user_rank: userRank,
    };
    res.json(payload);
  })
);

// --- REPORTS, APPEALS, MODERATION & ADMIN ---
apiRouter.post(
  '/reports',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to submit a report.');
    }
    if (!(await checkRateLimit(viewer.id, 'report', FOCUS_LIMITS.DAILY_REPORT_LIMIT, 24 * 3600_000))) {
      return sendError(res, 429, 'RATE_LIMITED', 'Daily report limit reached.');
    }
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Provide a reason for reporting.', zodErrorToFields(parsed.error));
    }
    if (parsed.data.target_type === 'post') {
      const p = await getPostById(parsed.data.target_id);
      if (!p || p.status === 'draft') {
        return sendError(res, 404, 'NOT_FOUND', 'Reported entry not found.');
      }
    } else {
      const c = await queryOne('SELECT id FROM comments WHERE id = $1', [parsed.data.target_id]);
      if (!c) {
        return sendError(res, 404, 'NOT_FOUND', 'Reported comment not found.');
      }
    }
    const duplicate = await queryOne(
      "SELECT id FROM reports WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3 AND status = 'open'",
      [viewer.id, parsed.data.target_type, parsed.data.target_id]
    );
    if (duplicate) {
      return sendError(res, 409, 'DUPLICATE_REPORT', 'You already have an open report for this item.');
    }

    await recordRateEvent(viewer.id, 'report');
    const reportId = `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const cleanReason = sanitizePlainText(parsed.data.reason);
    await executeSql(
      "INSERT INTO reports (id, reporter_id, target_type, target_id, reason, status, is_seed, created_at) VALUES ($1, $2, $3, $4, $5, 'open', 0, $6)",
      [reportId, viewer.id, parsed.data.target_type, parsed.data.target_id, cleanReason, nowIso]
    );

    res.status(201).json({
      report: {
        id: reportId,
        reporter_id: viewer.id,
        target_type: parsed.data.target_type,
        target_id: parsed.data.target_id,
        reason: cleanReason,
        status: 'open',
        created_at: nowIso,
      },
    });
  })
);

apiRouter.post(
  '/appeals',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Sign in to submit an appeal.');
    }
    const parsed = appealSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Explain why this moderation action should be reviewed.', zodErrorToFields(parsed.error));
    }
    if (parsed.data.target_type === 'user' && parsed.data.target_id !== viewer.id) {
      return sendError(res, 403, 'FORBIDDEN', 'You can only appeal enforcement on your own account.');
    }
    if (parsed.data.target_type === 'post') {
      const p = await getPostById(parsed.data.target_id);
      if (!p) return sendError(res, 404, 'NOT_FOUND', 'Post not found.');
      if (p.author_id !== viewer.id) return sendError(res, 403, 'FORBIDDEN', 'You can only appeal moderation on your own post.');
    }
    if (parsed.data.target_type === 'comment') {
      const c = await queryOne<{ author_id: string }>('SELECT author_id FROM comments WHERE id = $1', [parsed.data.target_id]);
      if (!c) return sendError(res, 404, 'NOT_FOUND', 'Comment not found.');
      if (c.author_id !== viewer.id) return sendError(res, 403, 'FORBIDDEN', 'You can only appeal moderation on your own comment.');
    }
    const appealId = `apl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    await executeSql(
      "INSERT INTO appeals (id, user_id, target_type, target_id, reason, status, reviewer_note, created_at) VALUES ($1, $2, $3, $4, $5, 'open', NULL, $6)",
      [appealId, viewer.id, parsed.data.target_type, parsed.data.target_id, sanitizePlainText(parsed.data.reason), nowIso]
    );
    res.status(201).json({ appeal: { id: appealId, status: 'open', created_at: nowIso } });
  })
);

apiRouter.get(
  '/admin/moderation',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer || (viewer.role !== 'moderator' && viewer.role !== 'admin')) {
      return sendError(res, 403, 'FORBIDDEN', 'Moderator or Admin role required.');
    }

    const [rawReports, rawAppeals, rawActions, rawUsers] = await Promise.all([
      query<Record<string, unknown>>('SELECT * FROM reports ORDER BY created_at DESC'),
      query<Record<string, unknown>>('SELECT * FROM appeals ORDER BY created_at DESC'),
      query<Record<string, unknown>>('SELECT * FROM mod_actions ORDER BY created_at DESC LIMIT 60'),
      viewer.role === 'admin'
        ? query<Record<string, unknown>>('SELECT * FROM users ORDER BY created_at DESC LIMIT 100')
        : Promise.resolve([]),
    ]);

    const reports = await Promise.all(
      rawReports.map(async (r) => {
        const reporter = await getUserById(String(r.reporter_id));
        let targetExcerpt = '';
        let targetStatus = 'unknown';
        let targetAuthorId: string | null = null;
        if (r.target_type === 'post') {
          const p = await getPostById(String(r.target_id));
          targetExcerpt = p ? p.title : 'Deleted post';
          targetStatus = p ? p.status : 'deleted';
          targetAuthorId = p?.author_id || null;
        } else {
          const cRow = await queryOne<Record<string, unknown>>('SELECT * FROM comments WHERE id = $1', [String(r.target_id)]);
          if (cRow) {
            const c = rowToComment(cRow);
            targetExcerpt = c.body.slice(0, 120);
            targetStatus = c.status;
            targetAuthorId = c.author_id;
          } else {
            targetExcerpt = 'Deleted comment';
            targetStatus = 'deleted';
          }
        }
        const targetAuthor = targetAuthorId ? await getUserById(targetAuthorId) : null;
        return {
          id: String(r.id),
          reporter_id: String(r.reporter_id),
          reporter_name: reporter?.display_name || 'Member',
          target_type: String(r.target_type) as 'post' | 'comment',
          target_id: String(r.target_id),
          reason: String(r.reason),
          status: String(r.status),
          target_excerpt: targetExcerpt,
          target_status: targetStatus,
          target_author_id: targetAuthorId,
          target_author_name: targetAuthor?.display_name || 'Unknown',
          target_author_banned: Boolean(targetAuthor?.banned),
          created_at: String(r.created_at),
        };
      })
    );

    const appeals = await Promise.all(
      rawAppeals.map(async (a) => {
        const u = await getUserById(String(a.user_id));
        return {
          id: String(a.id),
          user_id: String(a.user_id),
          user_name: u?.display_name || 'Member',
          target_type: String(a.target_type),
          target_id: String(a.target_id),
          reason: String(a.reason),
          status: String(a.status),
          reviewer_note: a.reviewer_note ? String(a.reviewer_note) : null,
          created_at: String(a.created_at),
        };
      })
    );

    const mod_actions = await Promise.all(
      rawActions.map(async (m) => {
        const mod = await getUserById(String(m.moderator_id));
        return {
          id: String(m.id),
          moderator_id: String(m.moderator_id),
          moderator_name: mod?.display_name || 'Moderator',
          target_type: String(m.target_type),
          target_id: String(m.target_id),
          action: String(m.action),
          note: String(m.note || ''),
          created_at: String(m.created_at),
        };
      })
    );

    const users = rawUsers.map((u) => rowToProfile(u, false));

    res.json({ reports, appeals, mod_actions, users });
  })
);

apiRouter.post(
  '/admin/moderation/action',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer || (viewer.role !== 'moderator' && viewer.role !== 'admin')) {
      return sendError(res, 403, 'FORBIDDEN', 'Moderator or Admin role required.');
    }
    const parsed = moderationActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid moderation action payload.', zodErrorToFields(parsed.error));
    }
    const { report_id, appeal_id, target_type, target_id, action, note } = parsed.data;
    const nowIso = new Date().toISOString();
    const cleanNote = sanitizePlainText(note || '');

    if (target_type === 'post') {
      const targetPost = await getPostById(target_id);
      if (!targetPost) return sendError(res, 404, 'NOT_FOUND', 'Target post not found.');
      if (action === 'hide') await executeSql("UPDATE posts SET status = 'hidden' WHERE id = $1", [target_id]);
      if (action === 'restore') await executeSql("UPDATE posts SET status = 'published' WHERE id = $1", [target_id]);
    } else if (target_type === 'comment') {
      const targetComment = await queryOne('SELECT id FROM comments WHERE id = $1', [target_id]);
      if (!targetComment) return sendError(res, 404, 'NOT_FOUND', 'Target comment not found.');
      if (action === 'hide') await executeSql("UPDATE comments SET status = 'hidden' WHERE id = $1", [target_id]);
      if (action === 'restore') await executeSql("UPDATE comments SET status = 'visible' WHERE id = $1", [target_id]);
    } else if (target_type === 'user') {
      const targetUser = await getUserById(target_id);
      if (!targetUser) return sendError(res, 404, 'NOT_FOUND', 'Target user not found.');
      if (target_id === viewer.id && action === 'ban') {
        return sendError(res, 400, 'CANNOT_BAN_SELF', 'You cannot suspend your own account.');
      }
      if (targetUser.role === 'admin' && viewer.role !== 'admin') {
        return sendError(res, 403, 'FORBIDDEN', 'Moderators cannot suspend or warn admin accounts.');
      }
      if (action === 'ban') await executeSql('UPDATE users SET banned = 1 WHERE id = $1', [target_id]);
      if (action === 'unban') await executeSql('UPDATE users SET banned = 0 WHERE id = $1', [target_id]);
      if (action === 'warn') {
        await executeSql(
          `INSERT INTO notifications (id, user_id, kind, title, body, href, read_at, is_seed, created_at)
           VALUES ($1, $2, 'warning', $3, $4, '/guidelines', NULL, 0, $5)`,
          [
            `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            target_id,
            'Moderation Warning',
            cleanNote || 'Please review the StrangeTheory Community Guidelines.',
            nowIso,
          ]
        );
      }
    } else if (target_type === 'report') {
      const rep = await queryOne('SELECT id FROM reports WHERE id = $1', [target_id]);
      if (!rep) return sendError(res, 404, 'NOT_FOUND', 'Target report not found.');
    }

    if (report_id) {
      await executeSql('UPDATE reports SET status = $1 WHERE id = $2', [
        action === 'dismiss_report' ? 'dismissed' : 'resolved',
        report_id,
      ]);
    }
    if (appeal_id) {
      if (action === 'approve_appeal') {
        await executeSql("UPDATE appeals SET status = 'approved', reviewer_note = $1 WHERE id = $2", [
          cleanNote || 'Approved',
          appeal_id,
        ]);
        if (target_type === 'post') await executeSql("UPDATE posts SET status = 'published' WHERE id = $1", [target_id]);
        if (target_type === 'comment') await executeSql("UPDATE comments SET status = 'visible' WHERE id = $1", [target_id]);
        if (target_type === 'user') await executeSql('UPDATE users SET banned = 0 WHERE id = $1', [target_id]);
      } else if (action === 'reject_appeal') {
        await executeSql("UPDATE appeals SET status = 'rejected', reviewer_note = $1 WHERE id = $2", [
          cleanNote || 'Decision upheld',
          appeal_id,
        ]);
      }
    }

    await executeSql(
      'INSERT INTO mod_actions (id, moderator_id, target_type, target_id, action, note, is_seed, created_at) VALUES ($1, $2, $3, $4, $5, $6, 0, $7)',
      [
        `mod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        viewer.id,
        target_type,
        target_id,
        action,
        cleanNote,
        nowIso,
      ]
    );

    res.json({ ok: true });
  })
);

apiRouter.post(
  '/admin/users/:userId/role',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer || viewer.role !== 'admin') {
      return sendError(res, 403, 'FORBIDDEN', 'Admin role required to change user roles.');
    }
    const role = String(req.body?.role || '') as UserRole;
    if (!['member', 'moderator', 'admin'].includes(role)) {
      return sendError(res, 400, 'INVALID_ROLE', 'Role must be member, moderator, or admin.');
    }
    if (req.params.userId === viewer.id && role !== 'admin') {
      return sendError(res, 400, 'CANNOT_DEMOTE_SELF', 'You cannot remove your own admin role.');
    }
    await executeSql('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.userId]);
    res.json({ ok: true, user: await getUserById(req.params.userId) });
  })
);

apiRouter.get(
  '/admin/overview',
  asyncHandler(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer || (viewer.role !== 'admin' && viewer.role !== 'moderator')) {
      return sendError(res, 403, 'FORBIDDEN', 'Admin or Moderator role required.');
    }
    const [totalUsersRow, totalPostsRow, openReportsRow, openAppealsRow, analyticsRows, errorLogs, outbox] = await Promise.all([
      queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM users'),
      queryOne<{ c: number }>("SELECT COUNT(*)::int AS c FROM posts WHERE status = 'published'"),
      queryOne<{ c: number }>("SELECT COUNT(*)::int AS c FROM reports WHERE status = 'open'"),
      queryOne<{ c: number }>("SELECT COUNT(*)::int AS c FROM appeals WHERE status = 'open'"),
      query<{ event_name: string; count: number }>(
        'SELECT event_name, COUNT(*)::int AS count FROM analytics_events GROUP BY event_name ORDER BY count DESC LIMIT 12'
      ),
      query('SELECT id, source, message, route, created_at FROM error_logs ORDER BY id DESC LIMIT 20'),
      process.env.NODE_ENV !== 'production'
        ? query('SELECT id, to_email, subject, provider, created_at FROM email_outbox ORDER BY created_at DESC LIMIT 15')
        : Promise.resolve([]),
    ]);

    res.json({
      counts: {
        totalUsers: Number(totalUsersRow?.c || 0),
        totalPosts: Number(totalPostsRow?.c || 0),
        openReports: Number(openReportsRow?.c || 0),
        openAppeals: Number(openAppealsRow?.c || 0),
      },
      analytics: analyticsRows,
      error_logs: errorLogs,
      outbox,
    });
  })
);

// --- PRIVACY-FIRST ANALYTICS & ERROR LOGGING ---
apiRouter.post(
  '/analytics/event',
  asyncHandler(async (req, res) => {
    try {
      const eventName = sanitizePlainText(String(req.body?.event_name || 'page_view')).slice(0, 60);
      const route = sanitizePlainText(String(req.body?.route || '/')).slice(0, 140);
      const meta = req.body?.meta && typeof req.body.meta === 'object' ? JSON.stringify(req.body.meta).slice(0, 500) : '{}';
      await executeSql('INSERT INTO analytics_events (event_name, route, meta_json, created_at) VALUES ($1, $2, $3, $4)', [
        eventName,
        route,
        meta,
        new Date().toISOString(),
      ]);
    } catch {
      // non-fatal
    }
    res.json({ ok: true });
  })
);

apiRouter.post(
  '/errors',
  asyncHandler(async (req, res) => {
    const msg = String(req.body?.message || 'Client error');
    const stack = String(req.body?.stack || '');
    const route = String(req.body?.route || '');
    captureServerException(new Error(msg), { route, extra: { source: 'client', stack: stack.slice(0, 500) } });
    await logServerError('client', msg, stack, route);
    res.json({ ok: true });
  })
);
