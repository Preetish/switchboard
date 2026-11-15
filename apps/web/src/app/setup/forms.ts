import type { ConfigInput } from "@switchboard/config";
import type { ColorScheme, FormField, FormFieldType, Layout } from "@switchboard/core";

/**
 * The form builder's state, and the way back to the config object. Each
 * form's name, submit label, self serve URL, HubSpot contact owner switch,
 * fields, and theme change here, and the org's default theme; everything
 * else in a form (slug, rules, custom CSS) is passed through untouched, so
 * saving without edits applies the same plan.
 *
 * Fields carry exactly what the field schema has (packages/core/src/forms):
 * key, label, type, required, options (select only), and help text. Select
 * options are plain strings: each one is both the value and the label.
 * Themes carry exactly the keys validateTheme knows
 * (packages/core/src/theme.ts).
 *
 * Plain functions with no React or I/O, so the save path is unit tested.
 */

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  email: "Email",
  number: "Number",
  select: "Dropdown",
  consent: "Consent checkbox",
};

export type FieldDraft = {
  /** Local key: survives reordering and renaming. */
  id: string;
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  /**
   * One option per entry. Kept while the type isn't select, so switching
   * back restores them; only select fields save them.
   */
  options: string[];
  helpText: string;
};

/** Every theme setting as text; empty means not set (the default, or the org's for a form). */
export type ThemeDraft = {
  accent: string;
  background: string;
  radius: string;
  colorScheme: "" | ColorScheme;
  layout: "" | Layout;
  fontFamily: string;
  fontStylesheet: string;
};

export type FormDraft = {
  slug: string;
  name: string;
  submitLabel: string;
  selfServeUrl: string;
  /** Set the HubSpot contact owner to the routed rep. */
  setHubspotOwner: boolean;
  fields: FieldDraft[];
  theme: ThemeDraft;
};

type FormInput = ConfigInput["forms"][number];

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

export function themeDraft(theme: unknown): ThemeDraft {
  const input = (typeof theme === "object" && theme !== null ? theme : {}) as Record<
    string,
    unknown
  >;
  const font = (
    typeof input.font === "object" && input.font !== null ? input.font : {}
  ) as Record<string, unknown>;
  return {
    accent: text(input.accent),
    background: text(input.background),
    radius: text(input.radius),
    colorScheme: text(input.colorScheme) as ThemeDraft["colorScheme"],
    layout: text(input.layout) as ThemeDraft["layout"],
    fontFamily: text(font.family),
    fontStylesheet: text(font.stylesheet),
  };
}

/** The theme for the config, or undefined when nothing is set. */
export function themeFromDraft(draft: ThemeDraft): Record<string, unknown> | undefined {
  const theme: Record<string, unknown> = {};
  const accent = draft.accent.trim();
  const background = draft.background.trim();
  const radius = draft.radius.trim();
  const family = draft.fontFamily.trim();
  const stylesheet = draft.fontStylesheet.trim();
  if (accent) theme.accent = accent;
  // A non-number is sent as typed, so the validator says what's wrong.
  if (radius) theme.radius = Number.isFinite(Number(radius)) ? Number(radius) : radius;
  if (draft.colorScheme) theme.colorScheme = draft.colorScheme;
  if (draft.layout) theme.layout = draft.layout;
  if (background) theme.background = background;
  if (family || stylesheet)
    theme.font = { family, ...(stylesheet ? { stylesheet } : {}) };
  return Object.keys(theme).length > 0 ? theme : undefined;
}

export function formsDraftsFromConfig(config: ConfigInput): {
  forms: FormDraft[];
  theme: ThemeDraft;
} {
  return {
    theme: themeDraft(config.theme),
    forms: config.forms.map((form, formIndex) => ({
      slug: form.slug,
      name: form.name,
      submitLabel: form.submitLabel ?? "",
      selfServeUrl: form.selfServeUrl ?? "",
      setHubspotOwner: form.setHubspotOwner ?? false,
      theme: themeDraft(form.theme),
      fields: (form.fields as FormField[]).map((field, i) => ({
        id: `field-${formIndex}-${i}`,
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        options: [...(field.options ?? [])],
        helpText: field.helpText ?? "",
      })),
    })),
  };
}

/** A field as the config writes it. */
export function fieldFromDraft(field: FieldDraft): FormField {
  const helpText = field.helpText.trim();
  return {
    key: field.key.trim(),
    label: field.label.trim(),
    type: field.type,
    required: field.required,
    ...(field.type === "select"
      ? { options: field.options.map((option) => option.trim()).filter(Boolean) }
      : {}),
    ...(helpText ? { helpText } : {}),
  };
}

/**
 * The full config to save: `config` with the org theme and each form's
 * name, settings, fields, and theme replaced by the drafts.
 */
export function buildFormsConfig(
  config: ConfigInput,
  forms: FormDraft[],
  orgTheme: ThemeDraft,
): ConfigInput {
  const { theme: _orgTheme, ...rest } = config;
  const theme = themeFromDraft(orgTheme);
  return {
    ...rest,
    ...(theme ? { theme } : {}),
    forms: config.forms.map((form, i): FormInput => {
      const draft = forms[i];
      if (!draft) return form;
      const {
        submitLabel: _label,
        selfServeUrl: _url,
        setHubspotOwner: _owner,
        theme: _theme,
        ...kept
      } = form;
      const submitLabel = draft.submitLabel.trim();
      const selfServeUrl = draft.selfServeUrl.trim();
      const formTheme = themeFromDraft(draft.theme);
      return {
        ...kept,
        name: draft.name.trim(),
        ...(submitLabel ? { submitLabel } : {}),
        ...(selfServeUrl ? { selfServeUrl } : {}),
        ...(draft.setHubspotOwner ? { setHubspotOwner: true } : {}),
        ...(formTheme ? { theme: formTheme } : {}),
        fields: draft.fields.map(fieldFromDraft),
      };
    }),
  };
}

/** A new short text field with a key no field on the form uses yet: field_1, field_2, ... */
export function newField(id: string, fields: FieldDraft[]): FieldDraft {
  const keys = new Set(fields.map((field) => field.key));
  let n = 1;
  while (keys.has(`field_${n}`)) n++;
  return {
    id,
    key: `field_${n}`,
    label: "New field",
    type: "text",
    required: false,
    options: [],
    helpText: "",
  };
}

/** The field after picking another type: consent fields are always required. */
export function changeType(field: FieldDraft, type: FormFieldType): FieldDraft {
  return { ...field, type, required: type === "consent" ? true : field.required };
}

export type FormErrors = {
  /** Name, submit label, self serve URL, owner switch, or the field list as a whole. */
  form: string[];
  /** By field draft id. */
  fields: Map<string, string[]>;
  theme: string[];
};

export type PlacedFormErrors = {
  /** By form index. */
  forms: Map<number, FormErrors>;
  /** The org's default theme. */
  theme: string[];
  /** Errors that don't name a form setting, field, or theme. */
  other: string[];
};

const FORM_SETTINGS = new Set([
  "name",
  "submitLabel",
  "selfServeUrl",
  "setHubspotOwner",
  "fields",
]);

/**
 * Sort the validator's errors to the form, field, or theme they name, using
 * the drafts that were sent. It names them as `forms[0].name: ...` (the
 * config's shape), `forms[0] (demo) fields: 2.label: ...` (a field by
 * position, or `email: duplicate field key` by key), `forms[0] (demo)
 * theme.accent: ...`, and `theme.accent: ...` for the org.
 */
export function placeFormErrors(errors: string[], drafts: FormDraft[]): PlacedFormErrors {
  const placed: PlacedFormErrors = { forms: new Map(), theme: [], other: [] };
  const formErrors = (index: number) => {
    let entry = placed.forms.get(index);
    if (!entry) {
      entry = { form: [], fields: new Map(), theme: [] };
      placed.forms.set(index, entry);
    }
    return entry;
  };
  for (const error of errors) {
    const orgTheme = /^theme(?:\.|: )(.*)$/.exec(error);
    if (orgTheme) {
      placed.theme.push(orgTheme[1]!);
      continue;
    }
    const shape = /^forms\[(\d+)\]\.(\w+)(.*)$/.exec(error);
    if (shape && drafts[Number(shape[1])]) {
      const [, index, key, rest] = shape;
      if (key === "theme") {
        formErrors(Number(index)).theme.push(rest!.replace(/^(?:\.|: )/, ""));
        continue;
      }
      if (FORM_SETTINGS.has(key!)) {
        formErrors(Number(index)).form.push(`${key}${rest}`);
        continue;
      }
    }
    const theme = /^forms\[(\d+)\] \([^)]*\) theme(?:\.|: )(.*)$/.exec(error);
    if (theme && drafts[Number(theme[1])]) {
      formErrors(Number(theme[1])).theme.push(theme[2]!);
      continue;
    }
    const fields = /^forms\[(\d+)\] \([^)]*\) fields: (.*)$/.exec(error);
    const draft = fields ? drafts[Number(fields[1])] : undefined;
    if (fields && draft) {
      const entry = formErrors(Number(fields[1]));
      const message = fields[2]!;
      const byIndex = /^(\d+)(?:\.(.*)|: (.*))$/.exec(message);
      const byKey = /^(.*): duplicate field key$/.exec(message);
      const field = byIndex
        ? draft.fields[Number(byIndex[1])]
        : byKey
          ? draft.fields.filter((candidate) => candidate.key.trim() === byKey[1]).at(-1)
          : undefined;
      if (field) {
        const text = byIndex
          ? (byIndex[2] ?? byIndex[3]!)
          : "this key is used by another field";
        entry.fields.set(field.id, [...(entry.fields.get(field.id) ?? []), text]);
      } else {
        entry.form.push(`fields: ${message}`);
      }
      continue;
    }
    placed.other.push(error);
  }
  return placed;
}
