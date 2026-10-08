import type { CapabilityGrant } from "@botifyr/shared";

/**
 * Apply one use to a capability's trust ladder (docs/product-plan.md §3):
 * successes accumulate toward a promotion review; any failure demotes one step
 * immediately (`trusted → probation`, else `gated`). Mutates and returns `grant`.
 */
export function applyCapabilityUse(grant: CapabilityGrant, ok: boolean, at = new Date()): CapabilityGrant {
  const state = grant.state ?? "gated";
  grant.successes = (grant.successes ?? 0) + (ok ? 1 : 0);
  grant.failures = (grant.failures ?? 0) + (ok ? 0 : 1);
  grant.lastUsedAt = at.toISOString();
  grant.updatedAt = grant.lastUsedAt;
  if (!ok) grant.state = state === "trusted" ? "probation" : "gated";
  return grant;
}

/** The number of consecutive-ish successes needed before a promotion is offered. */
export function promotionThreshold(capability: string): number {
  return capability.startsWith("ads.") || capability.startsWith("payments.") ? 10 : 5;
}

/** True when a capability has earned a promotion review. */
export function readyForPromotion(grant: CapabilityGrant): boolean {
  const state = grant.state ?? "gated";
  if (state === "trusted") return false;
  const needed = promotionThreshold(grant.capability);
  return (grant.successes ?? 0) >= needed && (grant.failures ?? 0) === 0;
}
