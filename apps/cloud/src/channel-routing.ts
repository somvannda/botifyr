import type { Workspace } from "@botifyr/shared";

/**
 * Inbound channel routing (docs/external-communications.md §8). When a company
 * runs its **own** bot, an inbound message must run **as the employee** that bot
 * answers for — so it inherits that role's instructions, tools and permissions —
 * instead of as a generic per-chat user. This module is the pure decision.
 */

/** Which workspace + employee a channel adapter is bound to. */
export interface ChannelScope {
  workspaceId: string;
  /** The employee (bot) this channel answers as. */
  botId: string;
}

/** The identity an inbound message runs with. */
export interface ChannelIdentity {
  /** The workspace owner (the account the run is billed to). */
  userId: string;
  /** The employee the run is attributed to (its role, tools and session). */
  authorId: string;
}

/**
 * Resolve the identity for a scoped adapter: the owner's account runs the task,
 * attributed to the employee. Returns null for an unscoped adapter (fall back to
 * the legacy per-chat user) or when the workspace owner is unknown.
 */
export function scopedChannelIdentity(
  scope: ChannelScope | undefined,
  workspace: Pick<Workspace, "ownerId"> | null | undefined,
): ChannelIdentity | null {
  if (!scope || !workspace?.ownerId) return null;
  return { userId: workspace.ownerId, authorId: scope.botId };
}
