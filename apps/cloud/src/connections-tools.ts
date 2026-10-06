import type { ToolDefinition } from "@botifyr/agent-core";
import { decryptSecret, encryptSecret } from "./vault.js";
import type { Store } from "./store/index.js";

/**
 * Agent tools that use the user's connected Google apps (Gmail, Calendar,
 * Drive). They read/act with the OAuth tokens stored (encrypted) at connect
 * time. If nothing is connected, the tools report that instead of failing.
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
}

async function accessTokenFor(
  store: Store,
  vaultKey: Buffer,
  userId: string,
  provider: string,
): Promise<string | null> {
  const record = await store.getConnection(userId, provider);
  if (!record) return null;
  let tokens: Tokens;
  try {
    tokens = JSON.parse(decryptSecret(vaultKey, record)) as Tokens;
  } catch {
    return null;
  }
  if (tokens.expiresAt && tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) return tokens.accessToken;

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) return tokens.accessToken;
  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) return tokens.accessToken;
    const data = (await response.json()) as { access_token: string; expires_in?: number };
    const refreshed: Tokens = {
      accessToken: data.access_token,
      refreshToken: tokens.refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    };
    const encrypted = encryptSecret(vaultKey, JSON.stringify(refreshed));
    await store.upsertConnection({
      ...record,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
    });
    return refreshed.accessToken;
  } catch {
    return tokens.accessToken;
  }
}

async function googleJson(
  url: string,
  token: string,
  init?: { method?: string; body?: string },
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body,
  });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { ok: response.ok, status: response.status, data };
}

function notConnected(app: string): { ok: boolean; output: string } {
  return { ok: false, output: `${app} isn't connected. Ask the user to connect it under "Connect apps".` };
}

export async function connectionToken(
  store: Store,
  vaultKey: Buffer,
  userId: string,
  provider: string,
): Promise<string | null> {
  return accessTokenFor(store, vaultKey, userId, provider);
}

export function createConnectionTools(store: Store, vaultKey: Buffer, userId: string): ToolDefinition[] {
  return [
    {
      name: "gmail.search",
      description:
        "Search the user's Gmail and return the most recent matching messages (sender, subject, snippet).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query, e.g. 'from:boss is:unread'." },
        },
        required: ["query"],
      },
      run: async (args) => {
        const token = await accessTokenFor(store, vaultKey, userId, "gmail");
        if (!token) return notConnected("Gmail");
        const query = String(args.query ?? "");
        const list = await googleJson(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=${encodeURIComponent(query)}`,
          token,
        );
        if (!list.ok)
          return {
            ok: false,
            output: `Gmail error ${list.status}: ${JSON.stringify(list.data).slice(0, 300)}`,
          };
        const ids = ((list.data as { messages?: Array<{ id: string }> }).messages ?? []).map((m) => m.id);
        const rows: string[] = [];
        for (const id of ids) {
          const msg = await googleJson(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
            token,
          );
          if (!msg.ok) continue;
          const data = msg.data as {
            snippet?: string;
            payload?: { headers?: Array<{ name: string; value: string }> };
          };
          const headers = data.payload?.headers ?? [];
          const from = headers.find((h) => h.name === "From")?.value ?? "?";
          const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
          rows.push(`- ${subject} — ${from}: ${(data.snippet ?? "").slice(0, 120)}`);
        }
        return { ok: true, output: rows.length ? rows.join("\n") : "No matching messages." };
      },
    },
    {
      name: "calendar.list",
      description: "List the user's upcoming Google Calendar events.",
      parameters: {
        type: "object",
        properties: { days: { type: "number", description: "How many days ahead to look (default 7)." } },
      },
      run: async (args) => {
        const token = await accessTokenFor(store, vaultKey, userId, "calendar");
        if (!token) return notConnected("Google Calendar");
        const days = Number(args.days ?? 7);
        const timeMin = new Date().toISOString();
        const timeMax = new Date(Date.now() + days * 86_400_000).toISOString();
        const result = await googleJson(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime` +
            `&maxResults=15&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
          token,
        );
        if (!result.ok)
          return {
            ok: false,
            output: `Calendar error ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`,
          };
        const items =
          (
            result.data as {
              items?: Array<{
                id?: string;
                summary?: string;
                start?: { dateTime?: string; date?: string };
              }>;
            }
          ).items ?? [];
        const rows = items.map(
          (event) =>
            `- [${event.id ?? "?"}] ${event.start?.dateTime ?? event.start?.date ?? "?"}  ${event.summary ?? "(no title)"}`,
        );
        return { ok: true, output: rows.length ? rows.join("\n") : "No upcoming events." };
      },
    },
    {
      name: "drive.search",
      description: "Search the user's Google Drive files and return matching names.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Drive search, e.g. \"name contains 'report'\"." },
        },
        required: ["query"],
      },
      run: async (args) => {
        const token = await accessTokenFor(store, vaultKey, userId, "drive");
        if (!token) return notConnected("Google Drive");
        const query = String(args.query ?? "");
        const result = await googleJson(
          `https://www.googleapis.com/drive/v3/files?pageSize=10&fields=files(id,name,mimeType,modifiedTime)` +
            `&q=${encodeURIComponent(query)}`,
          token,
        );
        if (!result.ok)
          return {
            ok: false,
            output: `Drive error ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`,
          };
        const files =
          (result.data as { files?: Array<{ name: string; mimeType: string; id: string }> }).files ?? [];
        const rows = files.map((file) => `- ${file.name} (${file.mimeType.split(".").pop()}, id ${file.id})`);
        return { ok: true, output: rows.length ? rows.join("\n") : "No matching files." };
      },
    },
    {
      name: "gmail.send",
      description: "Send an email from the user's Gmail.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["to", "subject", "body"],
      },
      requiresApproval: true,
      run: async (args) => {
        const token = await accessTokenFor(store, vaultKey, userId, "gmail");
        if (!token) return notConnected("Gmail");
        const mime =
          `To: ${String(args.to ?? "")}\r\n` +
          `Subject: ${String(args.subject ?? "")}\r\n` +
          `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
          `${String(args.body ?? "")}`;
        const raw = Buffer.from(mime, "utf8").toString("base64url");
        const result = await googleJson(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          token,
          {
            method: "POST",
            body: JSON.stringify({ raw }),
          },
        );
        return result.ok
          ? { ok: true, output: "Email sent." }
          : {
              ok: false,
              output: `Gmail error ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`,
            };
      },
    },
    {
      name: "calendar.create_event",
      description: "Create a Google Calendar event (ISO datetimes).",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          start: { type: "string", description: "ISO datetime, e.g. 2026-10-07T09:00:00Z" },
          end: { type: "string", description: "ISO datetime." },
        },
        required: ["summary", "start", "end"],
      },
      requiresApproval: true,
      run: async (args) => {
        const token = await accessTokenFor(store, vaultKey, userId, "calendar");
        if (!token) return notConnected("Google Calendar");
        const result = await googleJson(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          token,
          {
            method: "POST",
            body: JSON.stringify({
              summary: String(args.summary ?? ""),
              start: { dateTime: String(args.start ?? "") },
              end: { dateTime: String(args.end ?? "") },
            }),
          },
        );
        if (!result.ok)
          return {
            ok: false,
            output: `Calendar error ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`,
          };
        const link = (result.data as { htmlLink?: string }).htmlLink ?? "created";
        return { ok: true, output: `Event created: ${link}` };
      },
    },
    {
      name: "calendar.update_event",
      description: "Update a Google Calendar event by id (only the fields you pass change).",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string", description: "Event id from calendar.list" },
          summary: { type: "string" },
          start: { type: "string", description: "ISO datetime." },
          end: { type: "string", description: "ISO datetime." },
        },
        required: ["eventId"],
      },
      requiresApproval: true,
      run: async (args) => {
        const token = await accessTokenFor(store, vaultKey, userId, "calendar");
        if (!token) return notConnected("Google Calendar");
        const patch: Record<string, unknown> = {};
        if (args.summary !== undefined) patch.summary = String(args.summary);
        if (args.start !== undefined) patch.start = { dateTime: String(args.start) };
        if (args.end !== undefined) patch.end = { dateTime: String(args.end) };
        const result = await googleJson(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(String(args.eventId ?? ""))}`,
          token,
          { method: "PATCH", body: JSON.stringify(patch) },
        );
        if (!result.ok)
          return {
            ok: false,
            output: `Calendar error ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`,
          };
        const link = (result.data as { htmlLink?: string }).htmlLink ?? "updated";
        return { ok: true, output: `Event updated: ${link}` };
      },
    },
    {
      name: "calendar.delete_event",
      description: "Delete a Google Calendar event by id.",
      parameters: {
        type: "object",
        properties: { eventId: { type: "string", description: "Event id from calendar.list" } },
        required: ["eventId"],
      },
      requiresApproval: true,
      run: async (args) => {
        const token = await accessTokenFor(store, vaultKey, userId, "calendar");
        if (!token) return notConnected("Google Calendar");
        const result = await googleJson(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(String(args.eventId ?? ""))}`,
          token,
          { method: "DELETE" },
        );
        if (!result.ok)
          return {
            ok: false,
            output: `Calendar error ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`,
          };
        return { ok: true, output: "Event deleted." };
      },
    },
  ];
}
