import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { apiRouter } from './server/routes';
import { ensureDbReady, getDbEngineName, logServerError, query, queryOne } from './server/db';
import { captureServerException, initServerMonitoring, isServerMonitoringEnabled } from './server/monitoring';

const PORT = Number(process.env.PORT || 3000);

export function createApp() {
  initServerMonitoring();
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '7mb' }));
  app.use(cookieParser());

  // Security headers compatible with iframe embedding in studio/preview environments
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Lazily guarantee PostgreSQL / PGlite schema & seed are ready on serverless cold start
  app.use(async (_req, _res, next) => {
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
    const baseUrl = (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL')
      ? process.env.APP_URL.replace(/\/$/, '')
      : `${proto}://${host}`;
    res.type('text/plain').send(
      `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /my-brain\nDisallow: /collections\nDisallow: /dashboard\nDisallow: /drafts\nDisallow: /bookmarks\nDisallow: /notifications\nDisallow: /settings\nDisallow: /moderation\nDisallow: /admin\nSitemap: ${baseUrl}/sitemap.xml\n`
    );
  });

  app.get('/sitemap.xml', async (req, res, next) => {
    try {
      const host = req.get('host') || 'localhost:3000';
      const fwdProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
      const proto = fwdProto || req.protocol || 'http';
      const baseUrl = (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL')
        ? process.env.APP_URL.replace(/\/$/, '')
        : `${proto}://${host}`;

      const posts = await query<{ slug: string; type: 'experiment' | 'riddle'; updated_at: string }>(
        "SELECT slug, type, updated_at FROM posts WHERE status = 'published' ORDER BY published_at DESC"
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
      res.type('application/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`
      );
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/health', async (_req, res) => {
    try {
      await queryOne('SELECT 1 AS ok');
      res.json({
        ok: true,
        status: 'healthy',
        db: 'connected',
        engine: getDbEngineName(),
        storage: process.env.BLOB_READ_WRITE_TOKEN ? 'vercel_blob' : 'postgres_fallback',
        email: process.env.RESEND_API_KEY ? 'resend' : 'local_outbox',
        monitoring: isServerMonitoringEnabled() ? 'sentry' : 'db_error_logs',
        uptimeSeconds: Math.round(process.uptime()),
      });
    } catch (err) {
      res.status(503).json({
        ok: false,
        status: 'unhealthy',
        db: 'error',
        message: err instanceof Error ? err.message : 'Database connection error',
      });
    }
  });

  app.use('/api', apiRouter);

  app.use((err: Error & { status?: number; type?: string }, req: Request, res: Response, _next: NextFunction) => {
    if (err?.status === 413 || err?.type === 'entity.too.large') {
      if (!res.headersSent) {
        res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeds maximum allowed size.' });
      }
      return;
    }
    if (err?.status === 400 || err?.type === 'entity.parse.failed') {
      if (!res.headersSent) {
        res.status(400).json({ code: 'INVALID_JSON', message: 'Malformed JSON request body.' });
      }
      return;
    }
    captureServerException(err, { route: req.path });
    void logServerError('server', err.message || 'Unhandled server error', err.stack || '', req.path);
    if (!res.headersSent) {
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' });
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
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist/index.html'));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StrangeTheory server listening on http://localhost:${PORT}`);
  });
}

if (
  process.env.STRANGETHEORY_NO_LISTEN !== '1' &&
  !process.env.NODE_TEST_CONTEXT &&
  !process.env.VERCEL
) {
  startServer();
}
