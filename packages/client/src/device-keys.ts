/**
 * Per-device identity key storage for DM end-to-end encryption.
 *
 * Each device persists its own ECDH key pair; the public key is shared with
 * peers (later uploaded to the server as a "device key"), the private key never
 * leaves the device. Platform-agnostic: pass any `KeyStorage` (e.g. localStorage
 * in the browser, or a file-backed store on desktop).
 */
import { generateDeviceKeyPair, type DeviceKeyPair } from "./crypto.js";

export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = "botifyr.deviceKeys";

/** Load this device's key pair, generating and persisting one on first use. */
export async function loadOrCreateDeviceKeys(storage: KeyStorage): Promise<DeviceKeyPair> {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DeviceKeyPair;
      if (parsed?.publicKey && parsed?.privateKey) return parsed;
    } catch {
      // corrupt entry — regenerate below
    }
  }
  const pair = await generateDeviceKeyPair();
  storage.setItem(STORAGE_KEY, JSON.stringify(pair));
  return pair;
}

/** Forget this device's keys (e.g. a "reset encryption" action). */
export function clearDeviceKeys(storage: KeyStorage): void {
  storage.removeItem(STORAGE_KEY);
}
