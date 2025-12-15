export const ALLOWED_ORIGINS = [
  "https://jlo.julinemart.com",
  "https://www.jlo.julinemart.com",
  "https://dev-jlo.netlify.app", // ✅ DEV JLO
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8888",
];

export function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";

  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin)
      ? origin
      : ALLOWED_ORIGINS[0], // fallback to prod
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}
