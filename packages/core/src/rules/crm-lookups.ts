import type { RuleSet } from "./types.js";

/**
 * Unique `crm.*` paths a rule set needs, from `when` keys and dynamic
 * `{ to: crm.contact.owner }` routes. Callers prefetch these lookups once
 * (with a ~2s timeout, per the brief) and pass the results as flat inputs.
 */
export function crmPathsIn(ruleSet: RuleSet): string[] {
  const paths = new Set<string>();
  for (const rule of ruleSet.rules) {
    for (const path of Object.keys(rule.when)) {
      if (path.startsWith("crm.")) paths.add(path);
    }
    if ("to" in rule.route && rule.route.to.startsWith("crm.")) {
      paths.add(rule.route.to);
    }
  }
  if ("to" in ruleSet.fallback && ruleSet.fallback.to.startsWith("crm.")) {
    paths.add(ruleSet.fallback.to);
  }
  return [...paths].sort();
}
