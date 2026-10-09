import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Bot, Session } from "@botifyr/shared";
import type { BotifyrClient } from "@botifyr/client";
import { BOT_SCHEMES, BotLogo } from "./BotLogo";
import { Markdown } from "./Markdown";
import { SendIcon } from "./Icons";

/**
 * A docked chat panel beside the Startup Workspace so the founder can watch the
 * company (Home / Inbox / Team / Board / …) and chat at the same time. Clicking
 * an employee in the sidebar selects them here.
 *
 * It reads/writes the same conversations as the main chat (same sessions + send
 * API) and polls for replies; the main chat additionally uses the realtime stream.
 */
export function ChatDock({
  client,
  bots,
  selectedBotId,
  onSelect,
}: {
  client: BotifyrClient;
  bots: Bot[];
  selectedBotId?: string | null;
  onSelect?: (botId: string) => void;
}) {
  // A dock is for individual employees, not group chats.
  const employees = useMemo(
    () => bots.filter((bot) => !bot.memberIds || bot.memberIds.length === 0),
    [bots],
  );
  const [fallbackId, setFallbackId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setFallbackId((prev) =>
      prev && employees.some((bot) => bot.id === prev) ? prev : employees[0]?.id ?? "",
    );
  }, [employees]);

  const activeId =
    selectedBotId && employees.some((bot) => bot.id === selectedBotId) ? selectedBotId : fallbackId;
  const bot = employees.find((entry) => entry.id === activeId) ?? null;
  const session = bot ? sessions.find((entry) => entry.id === bot.sessionId) : undefined;
  const messages = session?.messages ?? [];

  const refresh = useCallback(async () => {
    try {
      setSessions(await client.listSessions());
    } catch {
      // keep the last good list
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeId]);

  async function submit() {
    const text = draft.trim();
    if (!text || !bot || busy) return;
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      await client.sendMessage(bot.sessionId, text);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send");
    } finally {
      setBusy(false);
    }
  }

  function send(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function select(id: string) {
    setFallbackId(id);
    onSelect?.(id);
  }

  return (
    <div className="cws-chat-dock">
      <div className="cws-chat-head">
        <select
          className="cws-select"
          value={activeId}
          onChange={(event) => select(event.target.value)}
          aria-label="Chat with"
        >
          {employees.length === 0 && <option value="">No employees</option>}
          {employees.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>
      <div className="thread cws-chat-thread" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="cws-muted">No messages yet — say hello to {bot?.name ?? "your team"}.</p>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="msg-user">
              <div className="msg-user-bubble">{message.content}</div>
            </div>
          ) : (
            <div key={message.id} className="msg-assistant">
              <BotLogo
                size={22}
                scheme={BOT_SCHEMES[(bot?.scheme ?? 0) % BOT_SCHEMES.length]}
                className="msg-bot-logo"
              />
              <div className="msg-body">
                <Markdown text={message.content} />
              </div>
            </div>
          ),
        )}
      </div>
      {error && <p className="cws-error cws-chat-error">{error}</p>}
      <form className="cws-chat-composer" onSubmit={send}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={`Message ${bot?.name ?? "your team"}`}
          rows={1}
        />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Send">
          <SendIcon size={15} />
        </button>
      </form>
    </div>
  );
}

export default ChatDock;
