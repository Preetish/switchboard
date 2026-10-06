import { z } from "zod";
import type { FormField } from "./types.js";

const FIELD_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const MAX_TEXT_LENGTH = 1000;
const MAX_TEXTAREA_LENGTH = 5000;
export const MAX_FIELDS = 50;

const fieldSchema = z
  .object({
    key: z
      .string()
      .regex(
        FIELD_KEY_RE,
        "Keys must be letters, digits and underscores, starting with a letter",
      ),
    label: z.string().min(1).max(200),
    type: z.enum(["text", "email", "select", "number", "textarea", "consent"]),
    required: z.boolean(),
    options: z.array(z.string().min(1).max(200)).max(100).optional(),
    helpText: z.string().max(300).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === "select" && (!field.options || field.options.length === 0)) {
      ctx.addIssue({
        code: "custom",
        message: "Select fields must list at least one option",
      });
    }
    if (field.type !== "select" && field.options !== undefined) {
      ctx.addIssue({ code: "custom", message: "Only select fields may define options" });
    }
    if (field.type === "consent" && !field.required) {
      ctx.addIssue({ code: "custom", message: "Consent fields must be required" });
    }
  });

export type FormFieldsResult =
  { ok: true; fields: FormField[] } | { ok: false; errors: string[] };

/** Validate a form definition before it is stored in `forms.fields`. */
export function validateFormFields(value: unknown): FormFieldsResult {
  const parsed = z.array(fieldSchema).max(MAX_FIELDS).safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const fields = parsed.data as FormField[];
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const field of fields) {
    if (seen.has(field.key)) errors.push(`${field.key}: duplicate field key`);
    seen.add(field.key);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, fields };
}

export type SubmissionErrors = Record<string, string>;

export type SubmissionResult =
  { ok: true; data: Record<string, string> } | { ok: false; errors: SubmissionErrors };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a submitted payload against a form definition. Returns cleaned
 * string values (trimmed, emails lowercased) ready for the rules engine and
 * `submissions.data`. Field-level errors are keyed by field key; unknown or
 * unexpected payloads produce a `_form` error.
 */
export function validateSubmission(
  fields: FormField[],
  payload: unknown,
): SubmissionResult {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errors: { _form: "Expected a JSON object of field values." } };
  }
  const values = payload as Record<string, unknown>;
  const errors: SubmissionErrors = {};
  const data: Record<string, string> = {};
  const allowed = new Set(fields.map((f) => f.key));

  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) errors[`_form.${key}`] = "Unexpected field.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  for (const field of fields) {
    const raw = values[field.key];
    const error = validateFieldValue(field, raw);
    if (error) {
      errors[field.key] = error;
      continue;
    }
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed !== "")
        data[field.key] = field.type === "email" ? trimmed.toLowerCase() : trimmed;
    } else if (raw !== undefined && raw !== null) {
      data[field.key] = String(raw);
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, data };
}

function validateFieldValue(field: FormField, raw: unknown): string | undefined {
  const empty =
    raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
  if (field.type === "consent") {
    if (raw === true || raw === "true") return undefined;
    if (empty) return "Please tick the box to continue.";
    return "This field must be true or false.";
  }
  if (empty) {
    return field.required ? `${field.label} is required.` : undefined;
  }
  if (typeof raw !== "string" && typeof raw !== "number") {
    return `${field.label} must be text.`;
  }
  const value = String(raw);
  switch (field.type) {
    case "email":
      return EMAIL_RE.test(value.trim()) ? undefined : "Enter a valid email address.";
    case "number":
      return Number.isFinite(Number(value)) ? undefined : "Enter a valid number.";
    case "select":
      return field.options?.includes(value)
        ? undefined
        : "Choose one of the listed options.";
    case "text":
      return value.length <= MAX_TEXT_LENGTH
        ? undefined
        : `Keep this under ${MAX_TEXT_LENGTH} characters.`;
    case "textarea":
      return value.length <= MAX_TEXTAREA_LENGTH
        ? undefined
        : `Keep this under ${MAX_TEXTAREA_LENGTH} characters.`;
  }
}

/** First email field's key, used to populate `submissions.email`. */
export function emailFieldKey(fields: FormField[]): string | undefined {
  return fields.find((f) => f.type === "email")?.key;
}
