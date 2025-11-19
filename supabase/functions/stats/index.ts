import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const ALLOWED_ORIGINS = [
  "https://jlo.julinemart.com",
  "https://www.jlo.julinemart.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin)
      ? origin
      : "https://jlo.julinemart.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase env vars");
}
const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req: Request) => {
  const headers = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (req.method !== "GET") {
      return new Response(
        JSON.stringify({ error: `${req.method} not supported` }),
        { status: 405, headers }
      );
    }

    const { data: orders } = await supabase
      .from("orders")
      .select("id, overall_status, created_at")
      .neq("overall_status", "cancelled");
    const { data: delivered } = await supabase
      .from("orders")
      .select("id")
      .eq("overall_status", "delivered");
    const { data: pending } = await supabase
      .from("orders")
      .select("id")
      .eq("overall_status", "processing");
    const { data: zones } = await supabase.from("zones").select("id");

    const payload = {
      success: true,
      data: {
        totalOrders: orders?.length ?? 0,
        shippedToday: delivered?.length ?? 0,
        pending: pending?.length ?? 0,
        activeZones: zones?.length ?? 0,
      },
    };

    return new Response(JSON.stringify(payload), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers,
    });
  }
});
