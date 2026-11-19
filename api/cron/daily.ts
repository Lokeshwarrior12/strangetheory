import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runDailyMaintenance } from '../../server/db';
import { captureServerException, initServerMonitoring } from '../../server/monitoring';

initServerMonitoring();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const sendJson = (status: number, body: Record<string, unknown>) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  try {
    const secret = process.env.CRON_SECRET?.trim();
    if (process.env.NODE_ENV === 'production' && !secret) {
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

    const result = await runDailyMaintenance();
    return sendJson(200, { ok: true, ...result });
  } catch (err) {
    captureServerException(err, { route: '/api/cron/daily' });
    return sendJson(500, {
      code: 'CRON_FAILED',
      message: err instanceof Error ? err.message : 'Daily maintenance job failed.',
    });
  }
}
