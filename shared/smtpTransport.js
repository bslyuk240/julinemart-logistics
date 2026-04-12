import { parseSmtpPort } from './smtpPort.js';

/**
 * Trim accidental whitespace / CRLF from copy-paste (common cause of "correct" passwords failing).
 * @param {unknown} user
 */
export function normalizeSmtpAuthUser(user) {
  if (user == null || user === '') return undefined;
  return String(user).trim();
}

/**
 * @param {unknown} pass
 */
export function normalizeSmtpAuthPass(pass) {
  if (pass == null || pass === '') return undefined;
  if (typeof pass !== 'string') return pass;
  return pass.replace(/\r\n/g, '').trim();
}

/**
 * Nodemailer transport options for custom SMTP (IONOS, etc.).
 *
 * - Port 587: secure false; STARTTLS is negotiated by nodemailer (we do not set requireTLS —
 *   strict requireTLS has been reported to break some IONOS STARTTLS handshakes).
 * - Port 465: secure true (implicit TLS).
 * - tls.servername + TLS 1.2+ for SNI / provider requirements.
 *
 * @param {Record<string, unknown>} config — expects smtp_host, smtp_port, smtp_user, smtp_password
 */
export function buildCustomSmtpTransportOptions(config) {
  const host = normalizeSmtpAuthUser(config.smtp_host);
  const port = parseSmtpPort(config.smtp_port);
  const secure = port === 465;
  const user = normalizeSmtpAuthUser(config.smtp_user);
  const pass = normalizeSmtpAuthPass(config.smtp_password);

  const opts = {
    host: host || undefined,
    port,
    secure,
    auth:
      user != null || pass != null
        ? {
            user,
            pass,
          }
        : undefined,
  };

  if (host) {
    opts.tls = {
      minVersion: 'TLSv1.2',
      servername: host,
    };
  }

  return opts;
}
