export const ENC_PREFIX: string;
export const EMAIL_CONFIG_DB_FIELDS: readonly string[];
export function pickEmailConfigForDatabase(row: Record<string, unknown>): Record<string, unknown>;
export function normalizeEncryptionKeyInput(raw: string | null | undefined): string;
export function getEncryptionKeyBuffer(): Buffer | null;
export function isEncryptionKeyEnvPresent(): boolean;
export function encryptSecretForStorage(
  plaintext: string | null | undefined
): string | null | undefined;
export function decryptSecretFromStorage(
  stored: string | null | undefined
): string | null | undefined;
export function decryptEmailConfigSecrets<T extends Record<string, unknown> | null>(
  config: T
): T;
export function getSmtpDecryptFailureMessage(
  mergedBeforeDecrypt: Record<string, unknown>,
  decrypted: Record<string, unknown>
): string | null;
export function encryptEmailConfigSecretsForStorage(
  config: Record<string, unknown>
): Record<string, unknown>;
export function sanitizeEmailConfigForClient(
  config: Record<string, unknown>
): Record<string, unknown> & {
  email_secrets_encryption_active?: boolean;
  email_secrets_key_env_present?: boolean;
};
