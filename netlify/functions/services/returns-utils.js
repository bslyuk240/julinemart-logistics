// Shared helpers for Returns (Supabase + Woo + Fez v1 Sandbox)
import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

/* --------------------------------------------------------
   ENVIRONMENT
--------------------------------------------------------- */
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";

const WOO_BASE = (process.env.WOOCOMMERCE_URL || "").replace(/\/$/, "");
const WOO_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY || "";
const WOO_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET || "";

// *** Fez Sandbox v1 — exactly same as working forward shipments ***
const FEZ_BASE = (process.env.FEZ_API_BASE_URL || "").replace(/\/$/, ""); 
// e.g. https://apisandbox.fezdelivery.co/v1

const FEZ_USER_ID = process.env.FEZ_USER_ID || ""; // sandbox email
const FEZ_PASSWORD = process.env.FEZ_PASSWORD || ""; // sandbox password

export const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

/* --------------------------------------------------------
   HELPERS
--------------------------------------------------------- */
export function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

export async function fetchWooOrder(orderId) {
  if (!WOO_BASE || !WOO_KEY || !WOO_SECRET)
    throw new Error("WooCommerce not configured");

  const url = `${WOO_BASE}/orders/${orderId}`;

  const res = await fetch(url, {
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString("base64"),
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Woo order fetch failed (${res.status})`);
  }

  return data;
}

export function validateReturnWindow(order, maxDays = 14) {
  const completedString =
    order?.date_completed ||
    order?.date_completed_gmt ||
    order?.date_paid ||
    order?.date_created ||
    order?.date_created_gmt;

  const completed = completedString ? new Date(completedString) : null;
  if (!completed || Number.isNaN(completed.getTime())) return false;

  return daysBetween(new Date(), completed) <= maxDays;
}

export function generateReturnCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let code = "RTN-";
  for (let i = 0; i < 6; i++)
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

/* ---------------- Phone Normalization ------------------- */
export function normalizePhone(phone) {
  if (!phone || typeof phone !== "string") return "+2340000000000";
  const digits = phone.replace(/\D+/g, "");
  if (digits.startsWith("234")) return `+${digits}`;
  if (digits.startsWith("0")) return `+234${digits.slice(1)}`;
  return `+${digits}`;
}

/* ---------------- Image Upload -------------------------- */
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function parseDataUrl(str) {
  const match = /^data:(.+);base64,(.+)$/i.exec(str);
  if (!match) return null;
  return { mime: match[1].trim().toLowerCase(), b64: match[2] };
}

function fileExtension(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

export async function uploadReturnImages(images = [], requestId) {
  if (!Array.isArray(images) || images.length === 0) return [];

  const bucket = supabase.storage.from("return-images");
  const urls = [];

  for (const img of images) {
    if (typeof img !== "string" || !img.trim()) continue;

    if (/^https?:\/\//i.test(img)) {
      urls.push(img);
      continue;
    }

    const parsed = parseDataUrl(img);
    if (!parsed) throw new Error("Invalid image format");

    const { mime, b64 } = parsed;
    if (!ALLOWED_IMAGE_TYPES.has(mime))
      throw new Error(`Unsupported image type: ${mime}`);

    const buffer = Buffer.from(b64, "base64");
    if (buffer.length === 0) throw new Error("Empty image");
    if (buffer.length > MAX_IMAGE_BYTES)
      throw new Error("Image exceeds 8MB");

    const filename = `${crypto.randomUUID()}.${fileExtension(mime)}`;
    const path = `return-images/${requestId}/${filename}`;

    const { error } = await bucket.upload(path, buffer, {
      contentType: mime,
      upsert: true,
    });
    if (error) throw error;

    const { data: publicData } = bucket.getPublicUrl(path);
    urls.push(publicData.publicUrl);
  }

  return urls;
}

/* --------------------------------------------------------
   HUB LOOKUP (REQUIRED FOR FEZ RECEIVER)
--------------------------------------------------------- */
export async function fetchHubFromDatabase(hubHint) {
  const { data: hubs, error } = await supabase
    .from("hubs")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) throw new Error("Failed to fetch hubs");
  if (!hubs?.length) throw new Error("No active hubs found");

  const hint = (hubHint?.name || "").toLowerCase();
  let matched = hubs.find((h) => h.name.toLowerCase().includes(hint));

  if (!matched) matched = hubs[0];

  if (!matched.address)
    throw new Error(`Hub "${matched.name}" has no address`);

  return {
    name: matched.name,
    address: matched.address,
    city: matched.city,
    state: matched.state,
    phone: normalizePhone(matched.phone),
  };
}

/* --------------------------------------------------------
   FEZ SANDBOX v1 AUTH
--------------------------------------------------------- */
async function authenticateFezSandbox() {
  if (!FEZ_BASE || !FEZ_USER_ID || !FEZ_PASSWORD) {
    throw new Error("Missing Fez sandbox environment variables");
  }

  const res = await fetch(`${FEZ_BASE}/user/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: FEZ_USER_ID,
      password: FEZ_PASSWORD,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (data?.status !== "Success") {
    throw new Error(data?.description || "Fez authentication failed");
  }

  return {
    token: data.authDetails?.authToken,
    secretKey: data.orgDetails?.["secret-key"],
  };
}

/* --------------------------------------------------------
   CREATE RETURN PICKUP — FEZ v1 FORMAT (WORKING)
--------------------------------------------------------- */
export async function createFezReturnPickup({ returnCode, customer, hub }) {
  const { token, secretKey } = await authenticateFezSandbox();

  const uniqueId = `JLO-RETURN-${returnCode}`;

  // 🔥 EXACT SAME FORMAT AS YOUR WORKING FORWARD SHIPMENTS
  const payload = {
    uniqueID: uniqueId,

    // RECEIVER = HUB (destination)
    recipientAddress: hub.address,
    recipientState: hub.state,
    recipientCity: hub.city,
    recipientName: hub.name,
    recipientPhone: hub.phone,
    recipientEmail: "",

    // SENDER = CUSTOMER (pickup location)
    pickUpAddress: customer.address,
    pickUpState: customer.state,
    pickUpCity: customer.city,
    senderName: customer.name,
    senderPhone: normalizePhone(customer.phone),
    senderEmail: customer.email ?? "",

    // Required fields
    BatchID: uniqueId,
    itemDescription: "Customer Return Item",
    valueOfItem: "1000",
    weight: 1,

    additionalDetails: `Return from ${customer.city}`,
  };

  console.log("FEZ RETURN PAYLOAD:", payload);

  const res = await fetch(`${FEZ_BASE}/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "secret-key": secretKey,
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {}

  console.log("FEZ RETURN RESPONSE:", raw);

  if (!res.ok || data.status === "Error") {
    throw new Error(data.description || raw);
  }

  // Fez returns tracking number inside orderNos
  let tracking = null;
  if (data.orderNos && typeof data.orderNos === "object") {
    tracking = Object.values(data.orderNos)[0];
  }

  return {
    tracking,
    shipmentId: tracking,
  };
}

/* --------------------------------------------------------
   STATUS MAPPING
--------------------------------------------------------- */
export function mapFezStatusToReturn(status) {
  const s = (status || "").toLowerCase();
  if (s.includes("pickup")) return "pickup_scheduled";
  if (s.includes("transit")) return "in_transit";
  if (s.includes("delivered")) return "delivered_to_hub";
  if (s.includes("cancel")) return "cancelled";
  return "pending";
}
