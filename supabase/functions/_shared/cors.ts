export const ALLOWED_ORIGINS = [
  "https://jlo.julinemart.com",
  "https://www.jlo.julinemart.com",
  "https://dev-jlo.netlify.app", // ✅ DEV JLO
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8888",
];

// Netlify PR deploy previews and branch deploys for the JLO dashboard site,
// e.g. https://deploy-preview-95--julinemart-logistics.netlify.app or
// https://preview-gift-boxes-g4-g6--julinemart-logistics.netlify.app
const NETLIFY_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?--julinemart-logistics\.netlify\.app$/;

function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.includes(origin) || NETLIFY_PREVIEW_ORIGIN.test(origin);
}

export function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";

  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin)
      ? origin
      : ALLOWED_ORIGINS[0], // fallback to prod
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}
