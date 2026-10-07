import type { ToolDefinition } from "@botifyr/agent-core";

/**
 * Email hand: outreach and support replies (docs/company-workspace.md Part V §40
 * — an owned channel, no platform approval). Sending is consequential →
 * approval-gated. The transport is injected; `resendSender` uses the account's
 * existing Resend config (`RESEND_API_KEY` + `MAIL_FROM`).
 */

export interface EmailSender {
  send(input: { to: string; subject: string; body: string }): Promise<boolean>;
}

export function resendSender(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): EmailSender {
  return {
    async send({ to, subject, body }) {
      try {
        const response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to, subject, html: body }),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

export function createEmailTools(sender: EmailSender | null): ToolDefinition[] {
  return [
    {
      name: "email.send",
      description:
        "Send an email — outreach, follow-ups, or a support reply. Needs the owner's approval before it sends.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address." },
          subject: { type: "string", description: "Subject line." },
          body: { type: "string", description: "Email body (HTML or plain text)." },
        },
        required: ["to", "subject", "body"],
      },
      requiresApproval: true,
      run: async (args) => {
        if (!sender) {
          return { ok: false, output: "Email isn't configured (set RESEND_API_KEY and MAIL_FROM)." };
        }
        const to = String(args.to ?? "")
          .trim()
          .slice(0, 200);
        const subject = String(args.subject ?? "")
          .trim()
          .slice(0, 200);
        const body = String(args.body ?? "").slice(0, 20_000);
        if (!to || !subject || !body) {
          return { ok: false, output: "to, subject and body are required." };
        }
        const ok = await sender.send({ to, subject, body });
        return ok ? { ok: true, output: `Email sent to ${to}.` } : { ok: false, output: "Email failed to send." };
      },
    },
  ];
}
