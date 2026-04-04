// supabase/functions/zones/index.ts

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

// ✅ SHARED CORS
import { corsHeaders } from "../_shared/cors.ts";

/**
 * ================================
 * SUPABASE CLIENT
 * ================================
 */
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase env vars");
}

const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req: Request) => {
  const headers = {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  };

  // ----------------------------
  // CORS PREFLIGHT
  // ----------------------------
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    // ----------------------------
    // GET ZONES
    // ----------------------------
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("zones")
        .select("*");

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, data }),
        { headers }
      );
    }

    // ----------------------------
    // UPSERT ZONE
    // ----------------------------
    if (req.method === "POST") {
      const payload = (await req.json().catch(() => null)) || {};

      const { data, error } = await supabase
        .from("zones")
        .upsert(payload, { onConflict: "id" })
        .select();

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, data }),
        { headers }
      );
    }

    return new Response(
      JSON.stringify({ error: `${req.method} not supported` }),
      { status: 405, headers }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers }
    );
  }
});
