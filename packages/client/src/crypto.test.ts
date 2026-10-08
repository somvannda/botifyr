// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  deriveSharedKey,
  generateDeviceKeyPair,
  isSealedMessage,
  openMessage,
  sealMessage,
} from "./crypto.js";

describe("dm crypto", () => {
  it("two devices derive the same key and the peer can decrypt", async () => {
    const alice = await generateDeviceKeyPair();
    const bob = await generateDeviceKeyPair();

    const aliceKey = await deriveSharedKey(alice.privateKey, bob.publicKey);
    const bobKey = await deriveSharedKey(bob.privateKey, alice.publicKey);

    const sealed = await sealMessage(aliceKey, "hello Bob 🔒");
    expect(isSealedMessage(sealed)).toBe(true);
    expect(sealed.ct).not.toContain("hello");

    expect(await openMessage(bobKey, sealed)).toBe("hello Bob 🔒");
  });

  it("a third device cannot decrypt", async () => {
    const alice = await generateDeviceKeyPair();
    const bob = await generateDeviceKeyPair();
    const eve = await generateDeviceKeyPair();

    const aliceKey = await deriveSharedKey(alice.privateKey, bob.publicKey);
    const eveKey = await deriveSharedKey(eve.privateKey, alice.publicKey);
    const sealed = await sealMessage(aliceKey, "secret");

    await expect(openMessage(eveKey, sealed)).rejects.toBeTruthy();
  });

  it("rejects tampered ciphertext", async () => {
    const alice = await generateDeviceKeyPair();
    const bob = await generateDeviceKeyPair();
    const key = await deriveSharedKey(alice.privateKey, bob.publicKey);
    const sealed = await sealMessage(key, "intact");

    const bytes = atob(sealed.ct);
    const flipped = bytes.slice(0, -1) + String.fromCharCode(bytes.charCodeAt(bytes.length - 1) ^ 1);
    await expect(openMessage(key, { ...sealed, ct: btoa(flipped) })).rejects.toBeTruthy();
  });

  it("isSealedMessage only accepts valid envelopes", () => {
    expect(isSealedMessage({ v: 1, iv: "a", ct: "b" })).toBe(true);
    expect(isSealedMessage("plain text")).toBe(false);
    expect(isSealedMessage({ v: 2, iv: "a", ct: "b" })).toBe(false);
  });
});
