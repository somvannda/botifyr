import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Secret vault.
 *
 * Secrets are encrypted with AES-256-GCM before they ever reach the store, so
 * even a leaked database row is useless without the master key. This is the
 * concrete fix for the "secrets not encrypted at rest" weakness seen in other
 * open agents.
 */

const ALGORITHM = "aes-256-gcm";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

/** Resolve the master key from BOTIFYR_VAULT_KEY (hex or passphrase). */
export function resolveVaultKey(): { key: Buffer; ephemeral: boolean } {
  const raw = process.env.BOTIFYR_VAULT_KEY;
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) {
    return { key: Buffer.from(raw, "hex"), ephemeral: false };
  }
  if (raw) {
    return { key: scryptSync(raw, "botifyr-vault", 32), ephemeral: false };
  }
  // Development fallback. Secrets will not survive a restart.
  return { key: scryptSync(randomBytes(16), "botifyr-vault", 32), ephemeral: true };
}

export function encryptSecret(key: Buffer, plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(key: Buffer, record: EncryptedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
