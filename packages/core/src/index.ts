export { domainFromEmail } from "./domain-from-email.js";
export type { FormField, FormFieldType } from "./forms/types.js";
export {
  MAX_FIELDS,
  emailFieldKey,
  validateFormFields,
  validateSubmission,
} from "./forms/validate.js";
export { FREE_EMAIL_DOMAINS, isFreeEmail } from "./rules/free-email.js";
export { crmPathsIn } from "./rules/crm-lookups.js";
export {
  actionKind,
  evaluate,
  isCatchAll,
  matchCondition,
  normalizeCondition,
  resolvePath,
} from "./rules/evaluate.js";
export { loadRuleSetYaml, parseRuleSetYaml } from "./rules/parse-yaml.js";
export { draftOutcome } from "./rules/outcome.js";
export type { OutcomeDraft, OutcomeKind } from "./rules/outcome.js";
export { selectRep } from "./strategies/select-rep.js";
export type { RepCandidate, RepSelection } from "./strategies/select-rep.js";
export { validateRuleSet } from "./rules/validate.js";
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
} from "./rules/types.js";
