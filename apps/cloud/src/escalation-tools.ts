import type { ToolDefinition } from "@botifyr/agent-core";

/**
 * Escalation: let an employee pause and ask the human owner when it is blocked —
 * a CAPTCHA or 2FA prompt, a login/checkpoint, missing access, or a decision only
 * the owner can make. Because it declares `requiresApproval`, the runner turns it
 * into a pending Approval that surfaces in the HQ "Needs you"; the CEO acts (or
 * solves it on the live screen), then the run continues.
 * docs/company-workspace.md §42.
 */
export function createEscalationTools(): ToolDefinition[] {
  return [
    {
      name: "company.escalate",
      description:
        "Pause and ask the human owner when you are blocked: a CAPTCHA or 2FA prompt, a login or security checkpoint, missing access/credentials, or a decision only they can make. Say exactly what you need them to do.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "What you need the owner to do." },
        },
        required: ["reason"],
      },
      requiresApproval: true,
      run: async (args) => {
        const reason = String(args.reason ?? "")
          .trim()
          .slice(0, 500);
        return { ok: true, output: reason ? `Escalated to the owner: ${reason}` : "Escalated to the owner." };
      },
    },
  ];
}
