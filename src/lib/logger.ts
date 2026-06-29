const isProd = process.env.NODE_ENV === 'production';

export const logger = {
  info: (message: string, ...args: unknown[]) => {
    if (!isProd) console.log(`[INFO] ${message}`, ...args);
  },
  warn: (message: string, ...args: unknown[]) => {
    if (!isProd) console.warn(`[WARN] ${message}`, ...args);
  },
  // Errors always log but never expose raw objects — only the message
  error: (message: string, error?: unknown) => {
    const detail = error instanceof Error ? { message: error.message } : undefined;
    console.error(`[ERROR] ${message}`, detail ?? '');
  },
  // Startup logs are always printed regardless of env
  startup: (message: string) => {
    console.log(message);
  },
};
