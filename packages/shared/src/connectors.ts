import type { CapabilityGrant, RoleDefinition } from "./index.js";

/**
 * Installable social connectors (docs/company-workspace.md Part V §44).
 *
 * A connector is an *app a workspace adds* to give its AI employees the social
 * and ads "hands" they need. Each connector declares the capability ids (from
 * `CAPABILITIES` in `catalog.ts`) it actually provides — one declaration that
 * drives three consumers:
 *
 *  - the marketplace UI (what the card explains + its capability badges),
 *  - role binding (what an employee can really do),
 *  - runtime routing (which adapter handles a capability).
 *
 * Capabilities come from the app added, not from assumption.
 */

/** What a connector connects to; drives marketplace grouping. */
export type ConnectorCategory = "social" | "messaging";

/** How a workspace pays for a connector. */
export type ConnectorBilling = "free" | "byo" | "reseller";

/** How the user connects their account. */
export type ConnectorAuthKind = "oauth" | "api-key" | "bot-token";

/** A marketplace-facing description of one installable connector. */
export interface ConnectorDef {
  id: string;
  name: string;
  vendor: string;
  category: ConnectorCategory;
  /** One line for the marketplace card. */
  summary: string;
  /** The "explain these features" prose for the detail panel. */
  description: string;
  /** Platforms this connector can reach. */
  platforms: string[];
  /** Capability ids (from CAPABILITIES) this app actually provides. */
  provides: string[];
  billing: { model: ConnectorBilling; note: string };
  auth: { kind: ConnectorAuthKind; label: string };
  /** Ordered steps shown in the connect drawer. */
  setup: string[];
  /** Transparency: whose app acts on the user's account. */
  actsOnBehalf: string;
  /** Anything the user should know before connecting. */
  limitations?: string[];
  docsUrl?: string;
}

/** The connectors a workspace can add today. */
export const CONNECTORS: ConnectorDef[] = [
  {
    id: "zernio",
    name: "Zernio",
    vendor: "Zernio",
    category: "social",
    summary: "Posts, comments, inbox and Meta ads through one API.",
    description:
      "Connects your Facebook, Instagram and Telegram accounts through Zernio's approved " +
      "platform apps. Publish, reply to comments and DMs, and manage Meta campaigns — " +
      "without Botifyr passing Meta App Review.",
    platforms: [
      "facebook",
      "instagram",
      "telegram",
      "x",
      "linkedin",
      "youtube",
      "threads",
      "bluesky",
      "pinterest",
      "reddit",
    ],
    provides: ["social.read_insights", "social.publish", "social.reply", "ads.manage"],
    billing: { model: "byo", note: "You pay Zernio ($6 per connected account; first 2 free)." },
    auth: { kind: "api-key", label: "Paste your Zernio API key" },
    setup: [
      "Create a free account at zernio.com.",
      "Connect your Facebook Page and Instagram.",
      "Copy your API key and paste it here.",
    ],
    actsOnBehalf: "Zernio's approved Meta app acts on your accounts with your authorization.",
    limitations: [
      "A Meta Ad Account counts as one connected account on top of the page.",
      "Inbox sends meter after 10,000 per month.",
    ],
    docsUrl: "https://docs.zernio.com",
  },
  {
    id: "socialapi",
    name: "SocialAPI.ai",
    vendor: "SocialAPI.ai",
    category: "social",
    summary: "Publishing plus a unified comments and DM inbox.",
    description:
      "Publishes posts and reads and replies to comments, DMs, mentions and reviews across " +
      "13 platforms. Full inbox — but no ad campaign management.",
    platforms: [
      "facebook",
      "instagram",
      "telegram",
      "x",
      "linkedin",
      "youtube",
      "threads",
      "bluesky",
      "pinterest",
      "tiktok",
    ],
    provides: ["social.read_insights", "social.publish", "social.reply"],
    billing: { model: "free", note: "Free for 2 brands (10 posts / 50 replies a month); $29/mo for 10." },
    auth: { kind: "api-key", label: "Paste your SocialAPI.ai key" },
    setup: [
      "Create an account at social-api.ai.",
      "Connect your social accounts.",
      "Copy your API key and paste it here.",
    ],
    actsOnBehalf: "SocialAPI.ai's approved platform apps act on your accounts.",
    limitations: ["No ad campaign management (use Zernio for Meta ads)."],
    docsUrl: "https://docs.social-api.ai",
  },
  {
    id: "publora",
    name: "Publora",
    vendor: "Publora",
    category: "social",
    summary: "Cheap publishing and scheduling to 10 platforms.",
    description:
      "Publishes and schedules posts to Facebook, Instagram, Telegram and 7 more networks. " +
      "Publishing only — no comments, inbox or ads.",
    platforms: [
      "facebook",
      "instagram",
      "telegram",
      "x",
      "linkedin",
      "youtube",
      "threads",
      "bluesky",
      "mastodon",
      "tiktok",
    ],
    provides: ["social.publish"],
    billing: { model: "free", note: "Starter is free (3 accounts, 15 posts/mo); Pro from $3.99/account." },
    auth: { kind: "api-key", label: "Paste your Publora API key" },
    setup: [
      "Create an account at publora.com.",
      "Connect your social accounts.",
      "Copy your API key and paste it here.",
    ],
    actsOnBehalf: "Publora's approved platform apps publish on your behalf.",
    limitations: ["No comments, inbox or ads — publishing only."],
    docsUrl: "https://docs.publora.com",
  },
  {
    id: "telegram",
    name: "Telegram",
    vendor: "Telegram (direct)",
    category: "messaging",
    summary: "Post to channels and answer DMs with your own bot — free.",
    description:
      "Connects directly to the Telegram Bot API. Post to channels and groups and reply to " +
      "messages sent to your bot. No aggregator, no approval, no fees.",
    platforms: ["telegram"],
    provides: ["social.publish", "social.reply"],
    billing: { model: "free", note: "Free — there are no fees." },
    auth: { kind: "bot-token", label: "Paste your bot token from @BotFather" },
    setup: [
      "Message @BotFather on Telegram and create a bot.",
      "Add the bot as an admin of your channel or group.",
      "Paste the bot token here.",
    ],
    actsOnBehalf: "Your own Telegram bot acts on your behalf.",
    limitations: [
      "A bot can only message people who started it — no cold DMs.",
      "Group privacy mode hides non-command messages unless you disable it.",
    ],
    docsUrl: "https://core.telegram.org/bots/api",
  },
];

/** Look up a connector by id. */
export function connectorById(id: string): ConnectorDef | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}

/** Connectors that provide a capability, in marketplace preference order. */
export function connectorsProviding(capability: string): ConnectorDef[] {
  return CONNECTORS.filter((connector) => connector.provides.includes(capability));
}

/** The capability ids the given connected connectors provide together. */
export function providedCapabilities(connectedIds: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const connector of CONNECTORS) {
    if (!connectedIds.includes(connector.id)) continue;
    for (const capability of connector.provides) out.add(capability);
  }
  return out;
}

/**
 * Route a capability to the connector that should run it: the first *connected*
 * connector (in `CONNECTORS` order) that provides it. `undefined` means nothing
 * the workspace has connected provides this capability.
 */
export function resolveConnector(
  capability: string,
  connectedIds: readonly string[],
): ConnectorDef | undefined {
  return connectorsProviding(capability).find((connector) => connectedIds.includes(connector.id));
}

/** Why a role capability is not usable right now. */
export type CapabilityMissingReason = "not-connected" | "not-granted" | "both";

export interface CapabilityAvailability {
  /** Capabilities the role can use now. */
  enabled: string[];
  /** Capabilities the role wants but can't use, with the reason. */
  missing: Array<{ capability: string; reason: CapabilityMissingReason; via: string[] }>;
  /** For each enabled capability, the connected connector ids that provide it. */
  enabledBy: Record<string, string[]>;
}

/**
 * What a role can actually do, given the connectors a workspace has connected
 * (and, at runtime, the grants it holds). Capabilities come from the app added.
 *
 * Pass `granted` for the runtime answer; omit it for the marketplace "what would
 * this connect unlock?" view (coverage only, grants not checked).
 */
export function capabilitiesFor(
  role: Pick<RoleDefinition, "capabilities">,
  opts: { connected?: readonly string[]; granted?: ReadonlyArray<Pick<CapabilityGrant, "capability" | "granted">> } = {},
): CapabilityAvailability {
  const connected = opts.connected ?? [];
  const provided = providedCapabilities(connected);
  const enforced = opts.granted !== undefined;
  const granted = new Set(
    (opts.granted ?? []).filter((grant) => grant.granted).map((grant) => grant.capability),
  );

  const enabled: string[] = [];
  const missing: CapabilityAvailability["missing"] = [];
  const enabledBy: Record<string, string[]> = {};

  for (const capability of role.capabilities) {
    const via = connectorsProviding(capability)
      .filter((connector) => connected.includes(connector.id))
      .map((connector) => connector.id);
    const hasProvider = provided.has(capability);
    const hasGrant = !enforced || granted.has(capability);

    if (hasProvider && hasGrant) {
      enabled.push(capability);
      enabledBy[capability] = via;
      continue;
    }
    const reason: CapabilityMissingReason =
      !hasProvider && !hasGrant ? "both" : !hasProvider ? "not-connected" : "not-granted";
    missing.push({ capability, reason, via });
  }

  return { enabled, missing, enabledBy };
}
