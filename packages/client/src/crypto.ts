/**
 * End-to-end encryption primitives for direct messages.
 *
 * Foundation for DM E2E: each device holds an ECDH (P-256) key pair; two peers
 * derive the same symmetric key from their private key and the other's public
 * key, then encrypt with AES-GCM. The server only ever sees ciphertext.
 *
 * Uses WebCrypto (`crypto.subtle`), available in browsers and Node 20+.
 */

const subtle = globalThis.crypto?.subtle;

export interface DeviceKeyPair {
  /** Public key, shared with peers (safe to publish). */
  publicKey: JsonWebKey;
  /** Private key, never leaves the device. */
  privateKey: JsonWebKey;
}

export interface SealedMessage {
  /** Format version, so the wire shape can evolve. */
  v: 1;
  /** Base64 AES-GCM initialisation vector. */
  iv: string;
  /** Base64 ciphertext (includes the GCM auth tag). */
  ct: string;
}

function requireSubtle(): SubtleCrypto {
  if (!subtle) throw new Error("WebCrypto is unavailable in this environment.");
  return subtle;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Generate a fresh device identity key pair (per device). */
export async function generateDeviceKeyPair(): Promise<DeviceKeyPair> {
  const pair = await requireSubtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  return {
    publicKey: await requireSubtle().exportKey("jwk", pair.publicKey),
    privateKey: await requireSubtle().exportKey("jwk", pair.privateKey),
  };
}

/**
 * Derive the shared AES-GCM key for a conversation from our private key and the
 * peer's public key. Both sides derive the same key (ECDH).
 */
export async function deriveSharedKey(privateKey: JsonWebKey, peerPublicKey: JsonWebKey): Promise<CryptoKey> {
  const webCrypto = requireSubtle();
  const own = await webCrypto.importKey("jwk", privateKey, { name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveKey",
  ]);
  const peer = await webCrypto.importKey(
    "jwk",
    peerPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  return webCrypto.deriveKey({ name: "ECDH", public: peer }, own, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypt a plaintext string for a conversation. */
export async function sealMessage(key: CryptoKey, plaintext: string): Promise<SealedMessage> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await requireSubtle().encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ciphertext)) };
}

/** Decrypt a sealed message. Throws if the key is wrong or the data was tampered with. */
export async function openMessage(key: CryptoKey, sealed: SealedMessage): Promise<string> {
  const plaintext = await requireSubtle().decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv) },
    key,
    fromBase64(sealed.ct),
  );
  return new TextDecoder().decode(plaintext);
}

/** Convenience: is this string a sealed-message envelope rather than plaintext? */
export function isSealedMessage(value: unknown): value is SealedMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SealedMessage>;
  return candidate.v === 1 && typeof candidate.iv === "string" && typeof candidate.ct === "string";
}
