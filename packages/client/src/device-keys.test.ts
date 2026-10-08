// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clearDeviceKeys, type KeyStorage, loadOrCreateDeviceKeys } from "./device-keys.js";

function memoryStorage(): KeyStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe("device-key storage", () => {
  it("generates a pair once and reuses it", async () => {
    const storage = memoryStorage();
    const first = await loadOrCreateDeviceKeys(storage);
    const second = await loadOrCreateDeviceKeys(storage);
    expect(second.publicKey).toEqual(first.publicKey);
    expect(second.privateKey).toEqual(first.privateKey);
  });

  it("clears the stored keys", async () => {
    const storage = memoryStorage();
    await loadOrCreateDeviceKeys(storage);
    clearDeviceKeys(storage);
    expect(storage.getItem("botifyr.deviceKeys")).toBeNull();
  });

  it("regenerates when the stored value is corrupt", async () => {
    const storage = memoryStorage();
    storage.setItem("botifyr.deviceKeys", "not json");
    const pair = await loadOrCreateDeviceKeys(storage);
    expect(pair.publicKey).toBeTruthy();
  });
});
