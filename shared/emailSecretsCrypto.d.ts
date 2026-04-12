export const ENC_PREFIX: string;
export function getEncryptionKeyBuffer(): Buffer | null;
export function encryptSecretForStorage(
  plaintext: string | null | undefined
): string | null | undefined;
export function decryptSecretFromStorage(
  stored: string | null | undefined
): string | null | undefined;
export function decryptEmailConfigSecrets<T extends Record<string, unknown> | null>(
  config: T
): T;
export function encryptEmailConfigSecretsForStorage(
  config: Record<string, unknown>
): Record<string, unknown>;
export function sanitizeEmailConfigForClient(config: Record<string, unknown>): Record<string, unknown> & {
  email_secrets_encryption_active?: boolean;
};
