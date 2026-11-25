import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runWeeklyMaintenance } from '../../server/db.js';
import { captureServerException, initServerMonitoring } from '../../server/monitoring.js';

initServerMonitoring();

function resolveOrigin(req: IncomingMessage): string | undefined {
  if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const host = req.headers.host;
  if (!host) return undefined;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${proto}://${host}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const sendJson = (status: number, body: Record<string, unknown>) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.end(JSON.stringify(body));
  };

  try {
    const secret = process.env.CRON_SECRET?.trim();
    if ((process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') && !secret) {
      return sendJson(503, { code: 'CRON_NOT_CONFIGURED', message: 'CRON_SECRET must be set in production.' });
    }
    if (secret) {
      const auth = String(req.headers.authorization || '');
      const expected = `Bearer ${secret}`;
      if (
        auth.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
      ) {
        return sendJson(401, { code: 'UNAUTHORIZED', message: 'Valid cron authorization required.' });
      }
    }

    const result = await runWeeklyMaintenance(resolveOrigin(req));
    return sendJson(200, { ok: true, ...result });
  } catch (err) {
    captureServerException(err, { route: '/api/cron/weekly' });
    return sendJson(500, {
      code: 'CRON_FAILED',
      message: err instanceof Error ? err.message : 'Weekly maintenance job failed.',
    });
  }
}
