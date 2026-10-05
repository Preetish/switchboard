import { parse } from "yaml";
import { validateRuleSet } from "./validate.js";
import type { ValidationResult } from "./types.js";

/** Parse a YAML rule file; returns readable errors for malformed YAML. */
export function parseRuleSetYaml(text: string): { ok: true; value: unknown } | { ok: false; errors: string[] } {
  try {
    return { ok: true, value: parse(text) };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

/**
 * Parse and validate a YAML rule file in one step. JSON rule files also work:
 * JSON is a subset of YAML.
 */
export function loadRuleSetYaml(text: string): ValidationResult {
  const parsed = parseRuleSetYaml(text);
  if (!parsed.ok) return parsed;
  return validateRuleSet(parsed.value);
}
