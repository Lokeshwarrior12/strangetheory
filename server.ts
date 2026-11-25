import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './server/routes.js';
import {
  checkDbHealth,
  DbConfigError,
  DbMigrationsPendingError,
  DbUnreachableError,
  ensureDbReady,
  getDbEngineName,
  logServerError,
  query,
} from './server/db.js';
import { captureServerException, initServerMonitoring, isServerMonitoringEnabled } from './server/monitoring.js';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

const PORT = Number(process.env.PORT || 3000);
const PRIVATE_APP_PREFIXES = [
  '/my-brain',
  '/collections',
  '/dashboard',
  '/drafts',
  '/bookmarks',
  '/notifications',
  '/settings',
  '/moderation',
  '/admin',
  '/new',
  '/edit',
];

function sanitizeRequestId(raw: string | undefined): string {
  if (raw && /^[a-zA-Z0-9_-]{8,64}$/.test(raw)) {
    return raw;
  }
  return crypto.randomUUID();
}

export function createApp() {
  initServerMonitoring();
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '7mb' }));
  app.use(cookieParser());

  // Request ID + structured JSON request logging
  app.use((req, res, next) => {
    const requestId = sanitizeRequestId(req.get('x-request-id'));
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const startNs = process.hrtime.bigint();
    res.on('finish', () => {
      if (process.env.NODE_TEST_CONTEXT && process.env.LOG_REQUESTS_IN_TEST !== '1') return;
      const reqPath = req.originalUrl.split('?')[0];
      if (!reqPath.startsWith('/api') && reqPath !== '/sitemap.xml' && reqPath !== '/robots.txt') return;
      const durationMs = Number(((Number(process.hrtime.bigint() - startNs)) / 1_000_000).toFixed(2));
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          event: 'http_request',
          requestId,
          method: req.method,
          path: reqPath,
          status: res.statusCode,
          durationMs,
        })
      );
    });

    next();
  });

  // Security headers compatible with iframe embedding in studio/preview environments
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Canonical APP_URL redirect (production only: redirects www.<domain> and *.vercel.app to APP_URL on GET/HEAD; skips /api/cron/* and /api/health)
  app.use((req, res, next) => {
    if (process.env.VERCEL_ENV !== 'production') return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const reqPath = req.originalUrl.split('?')[0];
    if (reqPath === '/api/health' || reqPath.startsWith('/api/cron/')) return next();

    const rawAppUrl = process.env.APP_URL?.trim();
    if (!rawAppUrl || rawAppUrl === 'MY_APP_URL') return next();

    let canonicalUrl: URL;
    try {
      canonicalUrl = new URL(rawAppUrl);
    } catch {
      return next();
    }

    const canonicalHost = canonicalUrl.host.toLowerCase();
    const canonicalHostname = canonicalUrl.hostname.toLowerCase();
    if (canonicalHostname === 'localhost' || canonicalHostname === '127.0.0.1') return next();

    const incomingHostRaw = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
    const incomingHostname = incomingHostRaw.split(':')[0];
    if (!incomingHostRaw || incomingHostname === 'localhost' || incomingHostname === '127.0.0.1') return next();

    const bareCanonical = canonicalHostname.replace(/^www\./, '');
    const isAliasHost =
      incomingHostname === `www.${bareCanonical}` ||
      incomingHostname.endsWith('.vercel.app');

    if (isAliasHost && incomingHostRaw !== canonicalHost) {
      return res.redirect(308, `${canonicalUrl.origin}${req.originalUrl}`);
    }
    return next();
  });

  // Ensure connection pool / local dev DB handle is initialized (no runtime DDL or seeding)
  app.use(async (req, _res, next) => {
    if (req.path === '/api/health') return next();
    try {
      await ensureDbReady();
      next();
    } catch (err) {
      next(err);
    }
  });

  app.get('/robots.txt', (req, res) => {
    const host = req.get('host') || 'localhost:3000';
    const fwdProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const proto = fwdProto || req.protocol || 'http';
    const baseUrl =
      process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
        ? process.env.APP_URL.replace(/\/$/, '')
        : `${proto}://${host}`;
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.type('text/plain').send(
      `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /my-brain\nDisallow: /collections\nDisallow: /dashboard\nDisallow: /drafts\nDisallow: /bookmarks\nDisallow: /notifications\nDisallow: /settings\nDisallow: /moderation\nDisallow: /admin\nSitemap: ${baseUrl}/sitemap.xml\n`
    );
  });

  app.get('/sitemap.xml', async (req, res, next) => {
    try {
      const host = req.get('host') || 'localhost:3000';
      const fwdProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
      const proto = fwdProto || req.protocol || 'http';
      const baseUrl =
        process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
          ? process.env.APP_URL.replace(/\/$/, '')
          : `${proto}://${host}`;

      const posts = await query<{ slug: string; type: 'experiment' | 'riddle'; updated_at: string }>(
        "SELECT slug, type, updated_at FROM posts WHERE status = 'published' ORDER BY published_at DESC NULLS LAST"
      );

      const staticPaths = [
        '/',
        '/explore',
        '/riddles',
        '/daily',
        '/weekly-riddle',
        '/leaderboard',
        '/about',
        '/guidelines',
        '/privacy',
        '/terms',
      ];
      const urls = [
        ...staticPaths.map((p) => `<url><loc>${baseUrl}${p}</loc><changefreq>daily</changefreq></url>`),
        ...posts.map(
          (p) =>
            `<url><loc>${baseUrl}/${p.type === 'riddle' ? 'riddle' : 'post'}/${p.slug}</loc><lastmod>${p.updated_at.slice(0, 10)}</lastmod></url>`
        ),
      ];
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
      res.type('application/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`
      );
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/health', async (req, res) => {
    const storageConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
    const emailConfigured = Boolean(process.env.RESEND_API_KEY?.trim());
    const sentryConfigured = isServerMonitoringEnabled();
    const sessionSecret = process.env.SESSION_SECRET?.trim() || '';
    const hasStrongSessionSecret =
      Boolean(sessionSecret) &&
      sessionSecret !== 'replace_with_a_long_random_secret_in_production' &&
      sessionSecret !== 'strangetheory_local_session_secret_key_2026';
    const appUrl = process.env.APP_URL?.trim() || '';
    const hasAppUrl = Boolean(appUrl && appUrl !== 'MY_APP_URL');
    const missingEnvVars: string[] = [];
    if (!process.env.DATABASE_URL?.trim()) missingEnvVars.push('DATABASE_URL');
    if (!hasStrongSessionSecret) missingEnvVars.push('SESSION_SECRET');
    if (!storageConfigured) missingEnvVars.push('BLOB_READ_WRITE_TOKEN');
    if (!process.env.CRON_SECRET?.trim()) missingEnvVars.push('CRON_SECRET');
    if (!emailConfigured) missingEnvVars.push('RESEND_API_KEY');
    if (!process.env.EMAIL_FROM?.trim()) missingEnvVars.push('EMAIL_FROM');
    if (!hasAppUrl) missingEnvVars.push('APP_URL');

    const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');

    try {
      const dbHealth = await checkDbHealth();
      if (!dbHealth.schemaVersion) {
        return res.status(503).json({
          ok: false,
          status: 'unhealthy',
          db: 'migrations_pending',
          dbLatencyMs: dbHealth.dbLatencyMs,
          schemaVersion: null,
          engine: getDbEngineName(),
          storage: storageConfigured ? 'vercel_blob' : 'postgres_fallback',
          storageConfigured,
          email: emailConfigured ? 'resend' : 'local_outbox',
          emailConfigured,
          sentryConfigured,
          monitoring: sentryConfigured ? 'sentry' : 'db_error_logs',
          missingEnvVars: isProd ? missingEnvVars : [],
          uptimeSeconds: Math.round(process.uptime()),
          message: 'Database migrations pending. Run npm run db:migrate.',
          requestId: req.requestId,
        });
      }

      return res.json({
        ok: true,
        status: 'healthy',
        db: 'connected',
        dbLatencyMs: dbHealth.dbLatencyMs,
        schemaVersion: dbHealth.schemaVersion,
        schemaName: dbHealth.schemaName,
        engine: getDbEngineName(),
        storage: storageConfigured ? 'vercel_blob' : 'postgres_fallback',
        storageConfigured,
        email: emailConfigured ? 'resend' : 'local_outbox',
        emailConfigured,
        sentryConfigured,
        monitoring: sentryConfigured ? 'sentry' : 'db_error_logs',
        missingEnvVars: isProd ? missingEnvVars : [],
        ...(isProd && missingEnvVars.length > 0
          ? { message: `Missing or placeholder production env vars: ${missingEnvVars.join(', ')}` }
          : {}),
        uptimeSeconds: Math.round(process.uptime()),
      });
    } catch (err) {
      const statusCode =
        err instanceof DbConfigError || err instanceof DbUnreachableError || err instanceof DbMigrationsPendingError
          ? err.status
          : 503;
      return res.status(statusCode).json({
        ok: false,
        status: 'unhealthy',
        db: 'error',
        dbLatencyMs: null,
        schemaVersion: null,
        engine: getDbEngineName(),
        storage: storageConfigured ? 'vercel_blob' : 'postgres_fallback',
        storageConfigured,
        email: emailConfigured ? 'resend' : 'local_outbox',
        emailConfigured,
        sentryConfigured,
        monitoring: sentryConfigured ? 'sentry' : 'db_error_logs',
        missingEnvVars: isProd ? missingEnvVars : [],
        uptimeSeconds: Math.round(process.uptime()),
        message: err instanceof Error ? err.message : 'Database connection error',
        requestId: req.requestId,
      });
    }
  });

  app.use('/api', apiRouter);

  app.use((err: Error & { status?: number; type?: string; code?: string }, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId;
    if (err?.status === 413 || err?.type === 'entity.too.large') {
      if (!res.headersSent) {
        res.status(413).json({
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request payload exceeds maximum allowed size.',
          requestId,
        });
      }
      return;
    }
    if (err?.status === 400 || err?.type === 'entity.parse.failed') {
      if (!res.headersSent) {
        res.status(400).json({
          code: 'INVALID_JSON',
          message: 'Malformed JSON request body.',
          requestId,
        });
      }
      return;
    }
    if (err instanceof DbConfigError || err instanceof DbUnreachableError || err instanceof DbMigrationsPendingError) {
      captureServerException(err, { route: req.path, method: req.method, code: err.code, requestId });
      if (!res.headersSent) {
        res.status(err.status).json({
          code: err.code,
          message: err.message,
          requestId,
        });
      }
      return;
    }
    if (err?.message?.includes('SESSION_SECRET environment variable')) {
      if (!res.headersSent) {
        res.status(503).json({
          code: 'CONFIG_ERROR',
          message: err.message,
          requestId,
        });
      }
      return;
    }

    captureServerException(err, { route: req.path, method: req.method, requestId });
    void logServerError('server', err.message || 'Unhandled server error', err.stack || '', req.path);
    if (!process.env.NODE_TEST_CONTEXT) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          event: 'unhandled_error',
          requestId,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          message: err.message || 'Unhandled server error',
        })
      );
    }
    if (!res.headersSent) {
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected server error occurred.',
        requestId,
      });
    }
  });

  return app;
}

async function startServer() {
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'replace_with_a_long_random_secret_in_production')
  ) {
    console.warn('SECURITY WARNING: Set a strong random SESSION_SECRET in production.');
  }
  const app = createApp();
  const httpServer = http.createServer(app);
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist/index.html'));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      const hasSessionCookie = Boolean(req.cookies?.st_session);
      const isPrivateRoute = PRIVATE_APP_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`));
      res.setHeader('Vary', 'Cookie');
      if (hasSessionCookie || isPrivateRoute) {
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      } else {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`StrangeTheory server listening on http://localhost:${PORT}`);
  });
}

const isDirectEntry =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (
  isDirectEntry &&
  process.env.STRANGETHEORY_NO_LISTEN !== '1' &&
  !process.env.NODE_TEST_CONTEXT &&
  !process.env.VERCEL
) {
  startServer();
}
