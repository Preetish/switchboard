import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Encryption for stored OAuth tokens (`integrations.token_cipher`).
 * AES-256-GCM, key from `TOKEN_ENCRYPTION_KEY` (32 bytes, hex). The blob is
 * `base64(iv[12] | authTag[16] | ciphertext)` — nothing is ever stored in
 * plaintext (operating rule 5).
 */

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function getEncryptionKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set — generate one with `openssl rand -hex 32` (see .env.example).",
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes).");
  }
  return Buffer.from(hex, "hex");
}

export function encryptJson(value: unknown, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/** Throws when the blob was tampered with or encrypted with another key. */
export function decryptJson<T>(blob: string, key: Buffer): T {
  const raw = Buffer.from(blob, "base64");
  if (raw.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted token blob is truncated.");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH)),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

/** Length-independent string comparison for secret keys. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Still burn a comparison so timing does not leak the length difference.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
