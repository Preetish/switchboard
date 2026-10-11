import { domainFromEmail } from "../domain-from-email.js";
import { emailFieldKey } from "../forms/validate.js";
import type { FormField } from "../forms/types.js";

/**
 * Derived `form.*` keys added on top of the submitted fields. A form field
 * with the same key always wins, so a form can collect its own value.
 */
export const DERIVED_FORM_KEYS = ["email_domain"] as const;

/**
 * Build the evaluation inputs for one submission: `form.*` is the validated
 * submission plus derived values (`form.email_domain` from the form's email
 * field), `crm.*` is whatever the caller prefetched (empty when none).
 */
export function buildRuleInputs(
  fields: FormField[],
  data: Record<string, string>,
  crm: Record<string, unknown> | null = null,
): { form: Record<string, string>; crm: Record<string, unknown> } {
  const form: Record<string, string> = { ...data };
  const emailKey = emailFieldKey(fields);
  const declared = new Set(fields.map((field) => field.key));
  if (emailKey && !declared.has("email_domain")) {
    const domain = domainFromEmail(data[emailKey]);
    if (domain) form.email_domain = domain;
  }
  return { form, crm: crm ?? {} };
}
