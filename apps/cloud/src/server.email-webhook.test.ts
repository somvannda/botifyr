import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";
import { encryptSecret } from "./vault.js";

/**
 * The Resend inbound webhook (docs/external-communications.md §13) is public, so
 * its Svix signature is the authentication and the raw body is the signed input.
 * This is the one place that can get those two wrong, so it is tested end to end
 * without a Resend account: the signature is computed the way Svix does.
 */

const vaultKey = Buffer.alloc(32, 7);
const SECRET = `whsec_${Buffer.from("webhook-signing-key").toString("base64")}`;

function sign(body: string, id = "msg_1", timestamp = "1700000000"): Record<string, string> {
  const key = SECRET.slice("whsec_".length);
  const digest = createHmac("sha256", Buffer.from(key, "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${digest}`,
  };
}

async function harness() {
  const store = new MemoryStore();
  const now = new Date().toISOString();
  const workspace = {
    id: "ws1",
    ownerId: "u1",
    name: "Acme",
    source: { kind: "idea" as const, value: "" },
    mission: "",
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
    email: { botId: "emp-support", from: "Bot <bot@acme.com>" },
  };
  await store.createWorkspace(workspace);
  const encrypted = encryptSecret(vaultKey, SECRET);
  await store.createSecret({
    id: randomUUID(),
    userId: "u1",
    workspaceId: workspace.id,
    name: "RESEND_WEBHOOK_SECRET",
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag,
    createdAt: now,
  });
  const ingest = vi.fn().mockReturnValue(true);
  const app = await buildServer({
    store,
    vaultKey,
    localChannel: createLocalChannel(),
    channels: { sendExternalReply: vi.fn().mockResolvedValue(true), ingest },
  });
  return { app, ingest };
}

describe("POST /v1/webhooks/resend/:id", () => {
  it("routes a signed inbound email to the workspace's email channel", async () => {
    const { app, ingest } = await harness();
    const body = JSON.stringify({
      type: "email.received",
      data: { from: "Sokha Chan <sokha@customer.com>", subject: "Delivery", text: "Do you deliver?" },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/resend/ws1",
      headers: sign(body),
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(ingest).toHaveBeenCalledWith("email:ws1", {
      conversationId: "sokha@customer.com",
      senderId: "sokha@customer.com",
      text: "Delivery\n\nDo you deliver?",
    });
  });

  it("rejects a bad signature with 401", async () => {
    const { app, ingest } = await harness();
    const body = JSON.stringify({ type: "email.received", data: { from: "a@b.c", text: "hi" } });
    const headers = sign(body);
    headers["svix-signature"] = "v1,not-the-right-signature";

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/resend/ws1",
      headers,
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("404s an unknown workspace", async () => {
    const { app } = await harness();
    const body = JSON.stringify({ type: "email.received", data: { from: "a@b.c", text: "hi" } });
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/resend/nope",
      headers: sign(body),
      payload: body,
    });
    expect(response.statusCode).toBe(404);
  });
});
