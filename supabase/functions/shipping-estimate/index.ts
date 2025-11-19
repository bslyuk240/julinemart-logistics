import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const ALLOWED_ORIGINS = [
  "https://jlo.julinemart.com",
  "https://www.jlo.julinemart.com",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : "https://jlo.julinemart.com";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

serve(async (req: Request) => {
  const headers = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(req.url);
    let payload: Record<string, unknown> = {
      success: true,
      method: req.method,
      timestamp: new Date().toISOString(),
    };

    if (req.method === "GET") {
      payload = {
        ...payload,
        query: Object.fromEntries(url.searchParams.entries()),
      };
    } else if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      payload = {
        ...payload,
        body,
      };
    } else {
      return new Response(
        JSON.stringify({ error: `${req.method} not supported` }),
        { status: 405, headers }
      );
    }

    return new Response(JSON.stringify(payload), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers,
    });
  }
});
