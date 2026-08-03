import { logActivity } from './logActivity';

// Caps total client-error rows one browser tab can write per session, and
// collapses repeats of the same error within a short window, so a broken
// third-party script or a tight retry loop can't flood activity_logs.
const MAX_ERRORS_PER_SESSION = 25;
const DEDUPE_WINDOW_MS = 10_000;

let errorCount = 0;
const recentErrors = new Map<string, number>();

function shouldLog(key: string): boolean {
  if (errorCount >= MAX_ERRORS_PER_SESSION) return false;
  const now = Date.now();
  const last = recentErrors.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return false;
  recentErrors.set(key, now);
  errorCount += 1;
  return true;
}

export function logClientError(error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const key = `${context?.area ?? ''}::${message}`;
  if (!shouldLog(key)) return;

  void logActivity({
    action: 'CLIENT_ERROR',
    resource_type: 'client_error',
    details: {
      message,
      stack: stack ? stack.slice(0, 2000) : undefined,
      path: window.location.pathname,
      ...context,
    },
  });
}

let installed = false;

// Catches uncaught exceptions and unhandled promise rejections anywhere in
// the admin dashboard. Errors that are already caught and handled in place
// (e.g. a validated upload failure) should call logClientError directly
// instead of relying on this.
export function installGlobalErrorLogging() {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    logClientError(event.error ?? event.message, { area: 'window.onerror' });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logClientError(event.reason, { area: 'unhandledrejection' });
  });
}
