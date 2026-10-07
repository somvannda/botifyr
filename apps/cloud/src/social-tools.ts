import type { ToolDefinition } from "@botifyr/agent-core";

/**
 * Social hands: read insights, publish, and reply on a connected page
 * (docs/company-workspace.md Part III). The provider client is injected so the
 * tools are testable and the real Meta/LinkedIn API client can drop in later.
 * Publishing and replying are consequential → they require the owner's approval.
 */
export interface SocialClient {
  /** e.g. "Facebook Page" / "LinkedIn". */
  provider: string;
  readInsights(): Promise<string>;
  publish(text: string): Promise<string>;
  reply(threadId: string, text: string): Promise<string>;
}

/** Used when no page is connected yet — the tools explain how to finish setup. */
export function notConnectedSocial(provider = "Meta or LinkedIn"): SocialClient {
  const message = `No ${provider} page is connected yet. Connect an account first (Settings → Connect apps).`;
  return {
    provider,
    readInsights: async () => message,
    publish: async () => message,
    reply: async () => message,
  };
}

export function createSocialTools(client: SocialClient): ToolDefinition[] {
  return [
    {
      name: "social.read_insights",
      description: `Read the connected ${client.provider} page's recent performance (reach, engagement).`,
      parameters: { type: "object", properties: {} },
      run: async () => {
        try {
          return { ok: true, output: await client.readInsights() };
        } catch (error) {
          return { ok: false, output: String(error) };
        }
      },
    },
    {
      name: "social.publish",
      description: `Publish a post to the connected ${client.provider} page. Needs the owner's approval.`,
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "The post text." } },
        required: ["text"],
      },
      requiresApproval: true,
      run: async (args) => {
        const text = String(args.text ?? "")
          .trim()
          .slice(0, 4000);
        if (!text) return { ok: false, output: "Post text is required." };
        try {
          return { ok: true, output: await client.publish(text) };
        } catch (error) {
          return { ok: false, output: String(error) };
        }
      },
    },
    {
      name: "social.reply",
      description: `Reply to a comment or DM on the connected ${client.provider} page. Needs the owner's approval.`,
      parameters: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "The comment/DM id." },
          text: { type: "string", description: "The reply text." },
        },
        required: ["threadId", "text"],
      },
      requiresApproval: true,
      run: async (args) => {
        const threadId = String(args.threadId ?? "").trim();
        const text = String(args.text ?? "")
          .trim()
          .slice(0, 4000);
        if (!threadId || !text) return { ok: false, output: "A thread and text are required." };
        try {
          return { ok: true, output: await client.reply(threadId, text) };
        } catch (error) {
          return { ok: false, output: String(error) };
        }
      },
    },
  ];
}
