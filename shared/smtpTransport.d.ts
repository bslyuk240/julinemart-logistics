export function normalizeSmtpAuthUser(user: unknown): string | undefined;
export function normalizeSmtpAuthPass(pass: unknown): string | undefined;
/** Nodemailer transport options for custom SMTP */
export function buildCustomSmtpTransportOptions(config: Record<string, unknown>): Record<string, unknown>;
