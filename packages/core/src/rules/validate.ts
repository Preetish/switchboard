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
    in: z.array(listable).min(1, "in needs at least one value").optional(),
    nin: z.array(listable).min(1, "nin needs at least one value").optional(),
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
  .refine((c) => Object.keys(c).length > 0, "condition must contain at least one operator")
  .refine(
    (c) => c.exists !== false || Object.keys(c).length === 1,
    "exists: false can't be combined with other operators (they need a value to compare)",
  );

/** Paths read `form.<field>` from the submission or `crm.<path>` from the CRM. */
const PATH_RE = /^(form|crm)\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

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
  when: z.record(z.string(), whenValueSchema).superRefine((when, ctx) => {
    for (const path of Object.keys(when)) {
      if (!PATH_RE.test(path)) {
        ctx.addIssue({
          code: "custom",
          path: [path],
          message: "paths start with form. or crm. (e.g. form.country, crm.contact.owner)",
        });
      }
    }
  }),
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
  )
  .superRefine((rs, ctx) => {
    // A rule with no conditions matches everything, so later rules never run.
    const catchAll = rs.rules.findIndex((rule) => Object.keys(rule.when).length === 0);
    if (catchAll !== -1 && catchAll < rs.rules.length - 1) {
      ctx.addIssue({
        code: "custom",
        path: ["rules", catchAll + 1],
        message: `unreachable: rule "${rs.rules[catchAll]!.name}" above has no conditions and matches every lead`,
      });
    }
    // The fallback must always land somewhere: a form./crm. path can be empty.
    if ("to" in rs.fallback && PATH_RE.test(rs.fallback.to)) {
      ctx.addIssue({
        code: "custom",
        path: ["fallback", "to"],
        message: "fallback can't route to a form./crm. path (it may be empty); use a team or a rep's email",
      });
    }
  });

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
