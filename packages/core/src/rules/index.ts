export { crmPathsIn } from "./crm-lookups.js";
export {
  actionKind,
  evaluate,
  isCatchAll,
  matchCondition,
  normalizeCondition,
  resolvePath,
} from "./evaluate.js";
export { FREE_EMAIL_DOMAINS, isFreeEmail } from "./free-email.js";
export { loadRuleSetYaml, parseRuleSetYaml } from "./parse-yaml.js";
export { validateRuleSet } from "./validate.js";
export type {
  Condition,
  Evaluation,
  RouteAction,
  Rule,
  RuleSet,
  RuleTrace,
  Strategy,
  ValidationResult,
  WhenClause,
} from "./types.js";
