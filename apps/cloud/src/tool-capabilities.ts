/**
 * Map agent tools to the capability they exercise, so revoked capabilities can
 * block their tools (docs/company-os.md §8). Default is "no capability" → never
 * blocked, so enforcement only ever *removes* access the owner explicitly revoked.
 */

const TOOL_CAPABILITIES: Array<[RegExp, string]> = [
  [/^social\.read_insights$/, "social.read_insights"],
  [/^social\.publish$/, "social.publish"],
  [/^social\.reply$/, "social.reply"],
  [/^email\./, "email.send"],
  [/^library\.(read|list)$/, "files.read"],
  [/^library\.write$/, "files.write"],
  [/^design\./, "files.write"],
  [/^browser\./, "browser.use"],
  [/^(shell|code)\./, "code.run"],
  [/^github\./, "repo.write"],
  [/^media\./, "research.web"],
];

/** The capability a tool exercises, or null when it isn't gated. */
export function capabilityForTool(name: string): string | null {
  for (const [pattern, capability] of TOOL_CAPABILITIES) {
    if (pattern.test(name)) return capability;
  }
  return null;
}

/** Drop tools whose capability is in the denied set. */
export function removeDeniedTools<T extends { name: string }>(tools: T[], denied: Set<string>): T[] {
  if (denied.size === 0) return tools;
  return tools.filter((tool) => {
    const capability = capabilityForTool(tool.name);
    return !capability || !denied.has(capability);
  });
}
