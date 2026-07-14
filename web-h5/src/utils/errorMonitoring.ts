import type { ClientErrorReport } from '@/types';

const recentErrors = new Map<string, number>();
const DEDUPE_WINDOW_MS = 60_000;

function safeMessage(value: unknown): string {
  if (value instanceof Error) return value.message.slice(0, 300);
  if (typeof value === 'string') return value.slice(0, 300);
  return 'Unknown client error';
}

function safeSource(value: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, window.location.origin).pathname.slice(0, 200);
  } catch {
    return undefined;
  }
}

function shouldReport(report: ClientErrorReport): boolean {
  const key = `${report.kind}:${report.message}:${report.source || ''}:${report.path}`;
  const now = Date.now();
  const previous = recentErrors.get(key) || 0;
  if (now - previous < DEDUPE_WINDOW_MS) return false;
  recentErrors.set(key, now);
  if (recentErrors.size > 100) {
    for (const [existingKey, timestamp] of recentErrors) {
      if (now - timestamp >= DEDUPE_WINDOW_MS) recentErrors.delete(existingKey);
    }
  }
  return true;
}

export function installErrorMonitoring(send: (report: ClientErrorReport) => Promise<void>): () => void {
  const dispatch = (report: ClientErrorReport) => {
    if (!shouldReport(report)) return;
    void send(report).catch(() => undefined);
  };

  const onError = (event: ErrorEvent) => dispatch({
    kind: 'error',
    message: safeMessage(event.error || event.message),
    source: safeSource(event.filename),
    path: window.location.pathname.slice(0, 200),
    line: event.lineno || undefined,
    column: event.colno || undefined,
  });
  const onUnhandledRejection = (event: PromiseRejectionEvent) => dispatch({
    kind: 'unhandled_rejection',
    message: safeMessage(event.reason),
    path: window.location.pathname.slice(0, 200),
  });

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}
