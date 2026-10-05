import { isFreeEmail } from "./free-email.js";
import type {
  Condition,
  Evaluation,
  RouteAction,
  Rule,
  RuleSet,
  RuleTrace,
  WhenClause,
} from "./types.js";

/** True for anything a submitted form would treat as "filled in". */
function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** Loose equality so string form values match numeric rule literals. */
function looseEq(actual: unknown, expected: string | number | boolean): boolean {
  if (!isPresent(actual)) return false;
  if (typeof actual === typeof expected) return actual === expected;
  if (typeof actual === "number" || typeof expected === "number") {
    if (typeof actual === "string" && actual.trim() === "") return false;
    const n = Number(actual);
    return Number.isFinite(n) && n === Number(expected);
  }
  return String(actual) === String(expected);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function compareToNumber(
  actual: unknown,
  op: "gt" | "gte" | "lt" | "lte",
  expected: number,
): boolean {
  const n = toNumber(actual);
  if (n === null) return false;
  switch (op) {
    case "gt":
      return n > expected;
    case "gte":
      return n >= expected;
    case "lt":
      return n < expected;
    case "lte":
      return n <= expected;
  }
}

/** Direct key hit first, then own-property walk for `a.b.c` paths. */
export function resolvePath(inputs: Record<string, unknown>, path: string): unknown {
  if (Object.hasOwn(inputs, path)) return inputs[path];
  let current: unknown = inputs;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function matchCondition(actual: unknown, condition: Condition): boolean {
  // Any operator on a missing value fails — except `exists`, which is the
  // only operator allowed to reason about absence.
  if (!isPresent(actual) && condition.exists === undefined) return false;
  let matched = true;
  if (condition.eq !== undefined && !looseEq(actual, condition.eq)) matched = false;
  if (condition.neq !== undefined && looseEq(actual, condition.neq)) matched = false;
  if (condition.in !== undefined) {
    if (!isPresent(actual) || !condition.in.some((v) => looseEq(actual, v))) matched = false;
  }
  if (condition.nin !== undefined && condition.nin.some((v) => looseEq(actual, v))) matched = false;
  if (condition.gt !== undefined && !compareToNumber(actual, "gt", condition.gt)) matched = false;
  if (condition.gte !== undefined && !compareToNumber(actual, "gte", condition.gte)) matched = false;
  if (condition.lt !== undefined && !compareToNumber(actual, "lt", condition.lt)) matched = false;
  if (condition.lte !== undefined && !compareToNumber(actual, "lte", condition.lte)) matched = false;
  if (condition.exists !== undefined && isPresent(actual) !== condition.exists) matched = false;
  if (condition.contains !== undefined) {
    if (!isPresent(actual) || !String(actual).includes(String(condition.contains))) matched = false;
  }
  if (condition.matches !== undefined) {
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(condition.matches);
    } catch {
      regex = null;
    }
    if (!regex || !isPresent(actual) || !regex.test(String(actual))) matched = false;
  }
  if (condition.freeEmail !== undefined && isFreeEmail(actual) !== condition.freeEmail) {
    matched = false;
  }
  if (condition.workEmail !== undefined) {
    if (!isPresent(actual) || isFreeEmail(actual) === condition.workEmail) matched = false;
  }
  return matched;
}

/** `exists` shorthand and bare scalars collapse to a full condition object. */
export function normalizeCondition(value: Condition | "exists" | string | number | boolean): Condition {
  if (typeof value === "object") return value;
  if (value === "exists") return { exists: true };
  return { eq: value };
}

/** All operators in one condition object must hold (AND); all paths must match. */
function firstFailingPath(when: WhenClause, inputs: Record<string, unknown>): string | null {
  for (const [path, rawCondition] of Object.entries(when)) {
    const actual = resolvePath(inputs, path);
    if (!matchCondition(actual, normalizeCondition(rawCondition))) return path;
  }
  return null;
}

/**
 * Evaluate a rule set against pre-fetched inputs. Pure and synchronous:
 * the caller resolves any `crm.*` lookups (see `crmPathsIn`) before calling.
 * Rules apply in order; the first match wins, otherwise the fallback fires.
 */
export function evaluate(ruleSet: RuleSet, inputs: Record<string, unknown>): Evaluation {
  const trace: RuleTrace[] = [];
  for (const rule of ruleSet.rules) {
    const failedOn = firstFailingPath(rule.when, inputs);
    if (failedOn === null) {
      return { matchedRule: rule.name, action: rule.route, trace };
    }
    trace.push({ rule: rule.name, matched: false, failedOn });
  }
  return { matchedRule: null, action: ruleSet.fallback, trace };
}

/** Rules whose `when` is empty match every submission. */
export function isCatchAll(rule: Rule): boolean {
  return Object.keys(rule.when).length === 0;
}

/** Helpers used by callers to turn an action into a stored outcome. */
export function actionKind(action: RouteAction): string {
  if ("to" in action) return "route_user";
  if ("team" in action) return "route_team";
  if (action.action === "self_serve_link") return "self_serve_link";
  return "fallback_queue";
}
