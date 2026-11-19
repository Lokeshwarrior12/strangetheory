import * as Sentry from '@sentry/node';

let serverSentryInitialized = false;

export function initServerMonitoring(): boolean {
  if (serverSentryInitialized) return Boolean(process.env.SENTRY_DSN);
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
  });
  serverSentryInitialized = true;
  return true;
}

export function captureServerException(
  err: unknown,
  context?: { route?: string; method?: string; code?: string; extra?: Record<string, string> }
) {
  if (!serverSentryInitialized) return;
  Sentry.withScope((scope) => {
    if (context?.route) scope.setTag('route', context.route);
    if (context?.method) scope.setTag('method', context.method);
    if (context?.code) scope.setTag('code', context.code);
    if (context?.extra) {
      for (const [k, v] of Object.entries(context.extra)) {
        scope.setExtra(k, v);
      }
    }
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}

export function isServerMonitoringEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN?.trim());
}
