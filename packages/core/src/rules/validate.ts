import { z } from "zod";
import type { Condition, RouteAction, Rule, RuleSet, Strategy, ValidationResult } from "./types.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const listable = z.union([z.string(), z.number()]);

function compilesRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

const conditionSchema = z
  .strictObject({
    eq: scalar.optional(),
    neq: scalar.optional(),
    in: z.array(listable).optional(),
    nin: z.array(listable).optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    exists: z.boolean().optional(),
    contains: listable.optional(),
    matches: z.string().refine(compilesRegex, "invalid regular expression").optional(),
    freeEmail: z.boolean().optional(),
    workEmail: z.boolean().optional(),
  })
  .refine((c) => Object.keys(c).length > 0, "condition must contain at least one operator");

/**
 * Accepts a full operator object, the bare word `exists`
 * (`{ exists: true }`), or any bare scalar (eq shorthand).
 */
const whenValueSchema = z
  .union([z.literal("exists"), scalar, conditionSchema])
  .transform((value): Condition => {
    if (value === "exists") return { exists: true };
    if (typeof value === "object") return value;
    return { eq: value };
  });

const routeActionSchema: z.ZodType<RouteAction> = z.union([
  z.strictObject({ to: z.string().min(1) }),
  z.strictObject({
    team: z.string().min(1),
    strategy: z.enum(["round_robin", "existing_owner"] satisfies Strategy[]),
  }),
  z.strictObject({ action: z.literal("self_serve_link") }),
  z.strictObject({ action: z.literal("fallback_queue") }),
]);

const ruleSchema = z.strictObject({
  name: z.string().min(1),
  when: z.record(z.string(), whenValueSchema),
  route: routeActionSchema,
});

const ruleSetSchema = z
  .strictObject({
    rules: z.array(ruleSchema),
    fallback: routeActionSchema,
  })
  .refine(
    (rs) => {
      const names = new Set<string>();
      for (const rule of rs.rules) {
        if (names.has(rule.name)) return false;
        names.add(rule.name);
      }
      return true;
    },
    { message: "rule names must be unique", path: ["rules"] },
  );

function formatIssuePath(path: PropertyKey[]): string {
  return path.length > 0 ? path.map(String).join(".") : "root";
}

/**
 * Validate an unparsed rule set (the JSON form of a YAML rule file).
 * Returns either the typed rule set or readable per-path error strings.
 */
export function validateRuleSet(value: unknown): ValidationResult {
  const parsed = ruleSetSchema.safeParse(value);
  if (parsed.success) {
    const { rules, fallback } = parsed.data;
    const typed: RuleSet = { fallback, rules: rules as Rule[] };
    return { ok: true, ruleSet: typed };
  }
  return {
    ok: false,
    errors: parsed.error.issues.map(
      (issue) => `${formatIssuePath(issue.path)}: ${issue.message}`,
    ),
  };
}
