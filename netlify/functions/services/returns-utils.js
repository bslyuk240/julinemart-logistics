/**
 * Shared helpers for Returns module
 * Fixes Fez Sandbox return issues
 */

import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// -----------------------------------------
// SUPABASE SETUP
// -----------------------------------------
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";

export const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// -----------------------------------------
// WOO SETUP
// -----------------------------------------
const WOO_BASE = (process.env.WOOCOMMERCE_URL || "").replace(/\/$/, "");
const WOO_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY || "";
const WOO_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET || "";

// -----------------------------------------
// FEZ SETUP (SANDBOX TEST URL)
// -----------------------------------------
const FEZ_BASE =
  (process.env.FEZ_API_BASE_URL || "").replace(/\/$/, "") ||
  "https://apisandbox.fezdelivery.co/v1";

const FEZ_API_KEY =
  process.env.FEZ_API_KEY || process.env.FEZ_PASSWORD || "";

// FIXED: Use the correct production User ID that works for regular shipments
const FEZ_USER_ID = process.env.FEZ_USER_ID || "G-Azan-8WgA";

// -----------------------------------------
// UTILITIES
// -----------------------------------------

export function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

export function validateReturnWindow(order, max = 14) {
  const d =
    order?.date_completed_gmt ||
    order?.date_completed ||
    order?.date_paid ||
    order?.date_created_gmt ||
    order?.date_created;

  if (!d) return false;
  return daysBetween(new Date(), new Date(d)) <= max;
}

export function generateReturnCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let c = "RTN-";
  for (let i = 0; i < 6; i++)
    c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

export function generateShortUniqueId(source) {
  const s = (source || crypto.randomUUID()).replace(/-/g, "").slice(-8);
  const ts = Date.now().toString(36);
  return `JLO-${s}-${ts}`.toUpperCase();
}

export function normalizePhone(p) {
  if (!p) return "+2340000000000";
  const d = p.replace(/\D+/g, "");
  if (d.startsWith("234")) return `+${d}`;
  if (d.startsWith("0")) return `+234${d.slice(1)}`;
  return `+234${d}`;
}

// -----------------------------------------
// IMAGE UPLOAD
// -----------------------------------------

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

function parseDataUrl(str) {
  const m = /^data:(.+);base64,(.+)$/i.exec(str);
  return m ? { mime: m[1].toLowerCase(), b64: m[2] } : null;
}

function mimeExt(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

export async function uploadReturnImages(images = [], requestId) {
  if (!Array.isArray(images) || images.length === 0) return [];

  const bucket = supabase.storage.from("return-images");
  const out = [];

  for (const img of images) {
    if (!img || typeof img !== "string") continue;

    if (/^https?:\/\//i.test(img)) {
      out.push(img);
      continue;
    }

    const parsed = parseDataUrl(img);
    if (!parsed) throw new Error("Invalid image format");

    const { mime, b64 } = parsed;
    if (!ALLOWED_TYPES.has(mime))
      throw new Error(`Unsupported image type: ${mime}`);

    const buf = Buffer.from(b64, "base64");
    if (buf.length > MAX_BYTES) throw new Error("Image exceeds 8MB limit");

    const filename = crypto.randomUUID() + "." + mimeExt(mime);
    // Store under the bucket root; avoid double "return-images/return-images" in public URLs
    const path = `${requestId}/${filename}`;

    const { error } = await bucket.upload(path, buf, {
      contentType: mime,
      upsert: true,
    });
    if (error) throw error;

    const { data } = bucket.getPublicUrl(path);
    if (!data?.publicUrl) throw new Error("Failed to get public URL");

    out.push(data.publicUrl);
  }

  return out;
}

// -----------------------------------------
// WOO ORDER FETCH
// -----------------------------------------

export async function fetchWooOrder(orderId) {
  if (!WOO_BASE) throw new Error("WooCommerce URL missing");

  const url = `${WOO_BASE}/orders/${orderId}`;
  const res = await fetch(url, {
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString("base64"),
    },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Woo fetch failed");

  return data;
}

export async function createWooRefund({
  orderId,
  amount,
  reason,
  apiRefund = true,
}) {
  if (!WOO_BASE) throw new Error("WooCommerce URL missing");
  if (!orderId) throw new Error("orderId is required for Woo refund");
  if (typeof amount !== "number" || amount <= 0)
    throw new Error("Refund amount must be a positive number");

  const payload = {
    amount: amount.toFixed(2),
    api_refund: apiRefund,
    ...(reason ? { reason } : {}),
  };

  const url = `${WOO_BASE}/orders/${orderId}/refunds`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString("base64"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok) {
    const message =
      data?.message ||
      (data?.data && typeof data.data === "object"
        ? Object.values(data.data)
            .flat()
            .map((entry) => entry?.message || entry)
            .join("; ")
        : null) ||
      "WooCommerce refund failed";
    throw new Error(message);
  }

  return data;
}

// -----------------------------------------
// FETCH HUB FROM DATABASE
// -----------------------------------------

export async function fetchHubFromDatabase(hubId) {
  const { data, error } = await supabase
    .from("hubs")
    .select("*")
    .eq("id", hubId)
    .single();

  if (error || !data) throw new Error("Hub not found");

  return {
    name: data.name,
    address: data.address,
    city: data.city,
    state: data.state,
    phone: normalizePhone(data.phone),
  };
}

// -----------------------------------------
// FEZ AUTH - FETCH FROM DATABASE
// -----------------------------------------

async function fezAuth() {
  // First try to get credentials from database
  const { data: courier, error } = await supabase
    .from('couriers')
    .select('api_user_id, api_password, api_base_url')
    .eq('code', 'fez')  // Note: lowercase 'fez' to match your schema
    .eq('api_enabled', true)
    .single();

  let userId, password, baseUrl;

  if (courier && !error) {
    // Use database credentials (preferred)
    userId = courier.api_user_id;
    password = courier.api_password;
    baseUrl = courier.api_base_url || FEZ_BASE;
    console.log("✅ Using credentials from database");
    console.log("Database User ID:", userId);
  } else {
    // Fallback to environment variables
    userId = FEZ_USER_ID;
    password = FEZ_API_KEY;
    baseUrl = FEZ_BASE;
    console.log("⚠️ Using credentials from environment variables (database fetch failed)");
    if (error) console.log("Database error:", error.message);
  }

  if (!baseUrl || !userId || !password) {
    throw new Error("Missing Fez API credentials (check database or env vars)");
  }

  console.log("Authenticating with Fez for returns...");
  console.log("FEZ_BASE:", baseUrl);
  console.log("FEZ_USER_ID:", userId);
  
  const res = await fetch(`${baseUrl}/user/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      password: password,
    }),
  });

  const data = await res.json();
  console.log("FEZ RETURN AUTH RESPONSE:", JSON.stringify(data, null, 2));

  if (data.status !== "Success") {
    throw new Error(data.description || "Fez auth failed");
  }

  // Validate auth response structure
  if (!data.authDetails || !data.authDetails.authToken) {
    throw new Error("Invalid auth response: missing authToken");
  }
  
  if (!data.orgDetails || !data.orgDetails["secret-key"]) {
    throw new Error("Invalid auth response: missing secret-key");
  }

  return {
    token: data.authDetails.authToken,
    secret: data.orgDetails["secret-key"],
  };
}

// -----------------------------------------
// CREATE RETURN PICKUP (SIMPLIFIED)
// -----------------------------------------

export async function createFezReturnPickup({ returnCode, customer, hub }) {
  const { token, secret } = await fezAuth();

  const uniqueId = `JLO-RETURN-${returnCode}`;

  // MINIMAL payload matching successful shipment structure
  const payload = [
    {
      // Sender/Pickup (customer)
      pickUpAddress: customer.address,
      pickUpState: customer.state,
      pickUpCity: customer.city || customer.state,

      // Recipient/Delivery (hub - as regular address)
      recipientAddress: hub.address,
      recipientState: hub.state,
      recipientCity: hub.city || hub.state,
      recipientName: hub.name,
      recipientPhone: normalizePhone(hub.phone),

      // Package details
      uniqueID: uniqueId,
      BatchID: uniqueId,
      valueOfItem: "1000",
      weight: 1,
      itemDescription: "Customer Return Item",
      additionalDetails: `Return to JulineMart - ${returnCode}`,
    }
  ];

  console.log("FEZ RETURN PAYLOAD:", JSON.stringify(payload, null, 2));

  const res = await fetch(`${FEZ_BASE}/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "secret-key": secret,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log("FEZ RETURN RESPONSE:", text);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid Fez response");
  }

  if (!res.ok || data.status === "Error") {
    throw new Error(data.description || "Fez return create failed");
  }

  // Extract tracking number
  const tracking = data.orderNos
    ? Object.values(data.orderNos)[0]
    : data.trackingNumber;

  if (!tracking) {
    console.error("No tracking number in response:", data);
    throw new Error("No tracking number returned from Fez");
  }

  return {
    tracking,
    shipmentId: tracking,
  };
}

// -----------------------------------------
// MAP FEZ STATUS
// -----------------------------------------

export function mapFezStatusToReturn(s) {
  s = (s || "").toLowerCase();
  if (s.includes("pickup")) return "pickup_scheduled";
  if (s.includes("transit")) return "in_transit";
  if (s.includes("delivered")) return "delivered_to_hub";
  if (s.includes("cancel")) return "cancelled";
  return "pending";
}
