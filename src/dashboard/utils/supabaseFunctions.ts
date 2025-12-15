const SUPABASE_BASE_URL =
  (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");

const ensureSupportsConfiguration = () => {
  if (!SUPABASE_BASE_URL) {
    throw new Error("Missing VITE_SUPABASE_URL in environment");
  }
};

const guardAgainstBrowserApiCalls = (url: string) => {
  if (url.includes("/api/")) {
    throw new Error("❌ Browser must NOT call Supabase /api/* endpoints");
  }
};

export const buildSupabaseFunctionUrl = (path: string) => {
  ensureSupportsConfiguration();

  const sanitizedPath = path.replace(/^\/+/, "");
  if (!sanitizedPath) {
    throw new Error("Supabase function path is required");
  }

  const url = `${SUPABASE_BASE_URL}/functions/v1/${sanitizedPath}`;
  guardAgainstBrowserApiCalls(url);
  return url;
};

export const assertNotCallingSupabaseApi = guardAgainstBrowserApiCalls;
