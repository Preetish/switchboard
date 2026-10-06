/**
 * Form field definitions. Stored as JSON in `forms.fields`; the canonical
 * type lives here so the rules engine, the DB schema, and the hosted form
 * all agree on one shape.
 */

export type FormFieldType =
  "text" | "email" | "select" | "number" | "textarea" | "consent";

export type FormField = {
  /** Stable key used in rule paths, e.g. `form.company_size`. */
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  /** Only meaningful (and required) for `select`. */
  options?: string[];
  helpText?: string;
};
