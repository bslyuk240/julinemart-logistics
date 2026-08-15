/**
 * Unit checks for gift delivery schedule + static inventory of gift APIs.
 * Run: node scripts/verify-gifts-built.mjs
 */
import {
  computeEarliestDeliveryDate,
  validateRequestedDeliveryDate,
  validateOccasionDate,
} from '../netlify/functions/services/gift-delivery-schedule.js';

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(name, cond, detail = '') {
  if (cond) pass(name, detail);
  else fail(name, detail || 'assertion failed');
}

// --- G5 schedule logic ---
{
  const gfc = { same_day_supported: false, next_day_supported: true, cutoff_time: '14:00:00' };
  const earliest = computeEarliestDeliveryDate({ gfc, maxLeadTimeDays: 0, packBufferDays: 1 });
  assert('G5 earliest with 0 lead + pack buffer', earliest instanceof Date);

  const past = validateRequestedDeliveryDate({
    gfc,
    requestedDate: '2020-01-01',
    maxLeadTimeDays: 0,
  });
  assert('G5 rejects past date', past.valid === false, past.error);

  const badFmt = validateRequestedDeliveryDate({
    gfc,
    requestedDate: 'not-a-date',
    maxLeadTimeDays: 0,
  });
  assert('G5 rejects bad format', badFmt.valid === false);

  const occasion = validateOccasionDate('2026-12-25');
  assert('G5 accepts future occasion', occasion.valid === true, occasion.occasion_date);
}

// --- Static file inventory ---
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const requiredFunctions = [
  'gift-pool-products.js',
  'gift-boxes.js',
  'gift-builder.js',
  'create-gift-order.js',
  'gift-shipping-quote.js',
  'gift-voucher-validate.js',
  'gift-delivery-dates.js',
  'gift-product-customisation.js',
  'admin-gift-ops.js',
  'admin-gift-boxes.js',
  'admin-gift-pool.js',
  'admin-gift-pool-sourced.js',
  'admin-gift-commercial-settings.js',
  'customer-gift-order.js',
  'gift-message-card.js',
];

for (const file of requiredFunctions) {
  const p = path.join(root, 'netlify/functions', file);
  assert(`JLO function ${file}`, fs.existsSync(p));
}

const requiredServices = [
  'gift-commercial.js',
  'gift-order-resolve.js',
  'gift-order-insert.js',
  'gift-voucher.js',
  'gift-delivery-schedule.js',
  'gift-customisation.js',
];

for (const file of requiredServices) {
  const p = path.join(root, 'netlify/functions/services', file);
  assert(`JLO service ${file}`, fs.existsSync(p));
}

const migrations = fs
  .readdirSync(path.join(root, 'supabase/migrations'))
  .filter((f) => f.includes('gift'));
assert('Gifts migrations present', migrations.length >= 8, `${migrations.length} files`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} static + unit checks passed\n`);
process.exit(failed ? 1 : 0);
