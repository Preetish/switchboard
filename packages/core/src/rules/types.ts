/**
 * Rule set types. Rule files are authored in YAML (git-friendly), stored as
 * parsed JSON in `rule_sets.rules`, and validated by `validateRuleSet`.
 *
 * Example:
 * ```yaml
 * rules:
 *   - name: Existing owner wins
 *     when: { crm.contact.owner: exists }
 *     route: { to: crm.contact.owner }
 *   - name: Enterprise
 *     when: { form.company_size: { gte: 500 } }
 *     route: { team: enterprise, strategy: round_robin }
 * fallback: { team: default, strategy: round_robin }
 * ```
 */

export type Strategy = "round_robin" | "existing_owner";

export type RouteAction =
  | { to: string }
  | { team: string; strategy: Strategy }
  | { action: "self_serve_link" }
  | { action: "fallback_queue" };

export type Condition = {
  eq?: string | number | boolean;
  neq?: string | number | boolean;
  in?: Array<string | number>;
  nin?: Array<string | number>;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  exists?: boolean;
  contains?: string | number;
  matches?: string;
  freeEmail?: boolean;
  workEmail?: boolean;
};

/**
 * Per-path condition. A bare scalar is shorthand for `{ eq: value }` and the
 * bare word `exists` for `{ exists: true }`, so the brief's
 * `when: { crm.contact.owner: exists }` validates as-is.
 */
export type WhenClause = Record<string, Condition | "exists" | string | number | boolean>;

export type Rule = {
  name: string;
  when: WhenClause;
  route: RouteAction;
};

export type RuleSet = {
  rules: Rule[];
  fallback: RouteAction;
};

export type RuleTrace = {
  rule: string;
  matched: boolean;
  /** First `when` path that failed; omitted for matched rules. */
  failedOn?: string;
};

export type Evaluation = {
  /** Name of the first matching rule; `null` when the fallback fired. */
  matchedRule: string | null;
  action: RouteAction;
  trace: RuleTrace[];
};

export type ValidationResult =
  | { ok: true; ruleSet: RuleSet }
  | { ok: false; errors: string[] };
