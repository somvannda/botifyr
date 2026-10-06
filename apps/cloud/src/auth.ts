import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

/** Password hashing and bearer-token helpers. */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const derived = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedToken {
  token: string;
  tokenHash: string;
  expiresAt: string;
}

export function createToken(ttlDays = 30): IssuedToken {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  return { token, tokenHash: hashToken(token), expiresAt };
}

export function newId(): string {
  return randomUUID();
}
