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

const FEZ_USER_ID = process.env.FEZ_USER_ID || "";

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
    const path = `return-images/${requestId}/${filename}`;

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
// FEZ AUTH - FIXED VERSION
// -----------------------------------------

async function fezAuth() {
  if (!FEZ_BASE || !FEZ_USER_ID || !FEZ_API_KEY) {
    throw new Error("Missing Fez API environment variables");
  }

  console.log("Authenticating with Fez for returns...");
  console.log("FEZ_BASE:", FEZ_BASE);
  console.log("FEZ_USER_ID:", FEZ_USER_ID);
  
  const res = await fetch(`${FEZ_BASE}/user/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: FEZ_USER_ID,
      password: FEZ_API_KEY,
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
// CREATE RETURN PICKUP (SANDBOX FORMAT FIX)
// -----------------------------------------

export async function createFezReturnPickup({ returnCode, customer, hub }) {
  const { token, secret } = await fezAuth();

  const uniqueId = `JLO-RETURN-${returnCode}`;

  const payload = {
    // REQUIRED
    recipientAddress: hub.address,
    recipientState: hub.state,
    recipientCity: hub.city,
    recipientName: hub.name,
    recipientPhone: hub.phone,

    uniqueID: uniqueId,
    BatchID: uniqueId,
    valueOfItem: "1000",
    weight: 1,

    // OPTIONAL BUT GOOD
    recipientEmail: "",
    itemDescription: "Customer Return Item",
    additionalDetails: "JulineMart Return Shipment",

    // PICKUP DETAILS
    pickUpAddress: customer.address,
    pickUpState: customer.state,
    pickUpCity: customer.city,

    senderName: customer.name,
    senderPhone: normalizePhone(customer.phone),
    senderEmail: "",

    // SANDBOX FIX
    lockerID: "", // <- REQUIRED for warehouse destination
  };

  console.log("FEZ RETURN PAYLOAD:", payload);

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

  if (!res.ok) {
    throw new Error(data.description || "Fez return create failed");
  }

  const tracking = data.orderNos
    ? Object.values(data.orderNos)[0]
    : data.trackingNumber;

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