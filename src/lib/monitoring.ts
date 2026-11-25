import * as Sentry from '@sentry/react';

let clientSentryInitialized = false;

export function initClientMonitoring(): boolean {
  if (clientSentryInitialized) return Boolean(import.meta.env.VITE_SENTRY_DSN);
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE || 'production',
    tracesSampleRate: 0.1,
  });
  clientSentryInitialized = true;
  return true;
}

export function captureClientException(err: unknown, extra?: Record<string, string>) {
  if (!clientSentryInitialized) return;
  Sentry.withScope((scope) => {
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        scope.setExtra(k, v);
      }
    }
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}
