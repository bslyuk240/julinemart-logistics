import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const ALLOWED_ORIGINS = [
  "https://jlo.julinemart.com",
  "https://www.jlo.julinemart.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const DEFAULT_ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
];

const DEFAULT_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const requestHeaders = req.headers.get("access-control-request-headers");
  const requestedMethod = req.headers.get("access-control-request-method");

  const allowedHeaders = new Set(DEFAULT_ALLOWED_HEADERS);
  if (requestHeaders) {
    requestHeaders.split(",").forEach((header) => {
      const sanitized = header.trim().toLowerCase();
      if (sanitized) allowedHeaders.add(sanitized);
    });
  }

  const allowedMethods = new Set(DEFAULT_ALLOWED_METHODS);
  if (requestedMethod) {
    allowedMethods.add(requestedMethod.toUpperCase());
  }

  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin)
      ? origin
      : "https://jlo.julinemart.com",
    "Access-Control-Allow-Headers": Array.from(allowedHeaders).join(", "),
    "Access-Control-Allow-Methods": Array.from(allowedMethods).join(", "),
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

serve(async (req: Request) => {
  const headers = {
    "Content-Type": "application/json",
    ...getCorsHeaders(req),
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  try {
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Verify authorization header (required for POST/DELETE, optional for GET)
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    let supabaseClient = supabaseService;
    let isAuthenticatedUser = false;

    if (authHeader) {
      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { authorization: authHeader } },
      });

      const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
      if (!authError && user) {
        supabaseClient = supabaseUser;
        isAuthenticatedUser = true;
      }
    }

    if (!isAuthenticatedUser && req.method !== "GET") {
      const message = authHeader ? "Invalid authorization token" : "Missing authorization header";
      return new Response(
        JSON.stringify({ code: 401, message }),
        { status: 401, headers }
      );
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const orderId = pathParts[pathParts.length - 1];

    if (req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 20);
      const offset = Number(url.searchParams.get("offset") || 0);

      const { data, error } = await supabaseClient
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, data }), {
        headers,
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { data, error } = await supabaseClient
        .from("orders")
        .insert(body)
        .select("*");

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, data }), {
        headers,
      });
    }

    if (req.method === "DELETE") {
      const { error } = await supabaseService
        .from("orders")
        .delete()
        .eq("id", orderId);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers,
      });
    }

    return new Response(
      JSON.stringify({ error: `${req.method} not supported` }),
      { status: 405, headers }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers,
    });
  }
});
