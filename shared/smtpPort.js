/**
 * Form/JSON often sends smtp_port as a string. Coerce so port 465 enables SSL (string "465" === 465 was false).
 * @param {unknown} value
 * @returns {number}
 */
export function parseSmtpPort(value) {
  const n = parseInt(String(value ?? '').trim(), 10);
  if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  return 587;
}
