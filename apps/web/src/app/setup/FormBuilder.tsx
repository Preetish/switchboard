"use client";

import type { FormFieldType } from "@switchboard/core/client";
import { useRef, type Dispatch, type SetStateAction } from "react";
import styles from "../admin.module.css";
import {
  FIELD_TYPE_LABELS,
  changeType,
  newField,
  type FieldDraft,
  type FormDraft,
  type PlacedFormErrors,
  type ThemeDraft,
} from "./forms";
import { FieldErrors } from "./RepsTeamsEditor";
import { move } from "./rules";

/**
 * Each form's name, submit label, self serve URL, HubSpot contact owner
 * switch, fields, and theme, and the default theme every form starts from.
 * The drafts live in SetupEditor, which saves them with the reps, teams, and
 * rules in one config; the validator's errors show next to the form, field,
 * or theme they name.
 */
export default function FormBuilder({
  forms,
  setForms,
  theme,
  setTheme,
  errors,
}: {
  forms: FormDraft[];
  setForms: Dispatch<SetStateAction<FormDraft[]>>;
  /** The org's default theme. */
  theme: ThemeDraft;
  setTheme: Dispatch<SetStateAction<ThemeDraft>>;
  /** From the last failed save. */
  errors: PlacedFormErrors | null;
}) {
  const nextId = useRef(0);

  const updateForm = (formIndex: number, change: (form: FormDraft) => FormDraft) =>
    setForms((current) =>
      current.map((form, i) => (i === formIndex ? change(form) : form)),
    );
  const updateField = (
    formIndex: number,
    id: string,
    change: (field: FieldDraft) => FieldDraft,
  ) =>
    updateForm(formIndex, (form) => ({
      ...form,
      fields: form.fields.map((field) => (field.id === id ? change(field) : field)),
    }));

  return (
    <>
      <h2 className={styles.groupTitle}>Form builder</h2>
      <p className={styles.sectionBody}>
        Edit each form&apos;s fields and look, then save. Rules read a field by its key,
        as in <code className={styles.code}>form.company_size</code>, so changing a key
        breaks the rules that use it until they are updated. The previews above show the
        saved forms.
      </p>

      <section className={styles.section} aria-labelledby="theme-default">
        <h3 id="theme-default" className={styles.sectionTitle}>
          Default theme
        </h3>
        <p className={styles.sectionBody}>
          Every form uses this look unless it sets its own.
        </p>
        <ThemeControls theme={theme} onChange={setTheme} unsetLabel="Default" />
        <FieldErrors errors={errors?.theme.length ? errors.theme : undefined} />
      </section>

      {forms.map((form, formIndex) => {
        const formErrors = errors?.forms.get(formIndex);
        return (
          <section
            key={form.slug}
            className={styles.section}
            aria-labelledby={`builder-${form.slug}`}
          >
            <h3 id={`builder-${form.slug}`} className={styles.sectionTitle}>
              {form.name || form.slug}{" "}
              <span className={styles.muted}>· /f/{form.slug}</span>
            </h3>
            <div className={styles.formGrid}>
              <label className={styles.inlineLabel}>
                Name
                <input
                  className={styles.inputSmall}
                  value={form.name}
                  onChange={(event) =>
                    updateForm(formIndex, (f) => ({ ...f, name: event.target.value }))
                  }
                />
              </label>
              <label className={styles.inlineLabel}>
                Submit button label
                <input
                  className={styles.inputSmall}
                  placeholder="Continue"
                  maxLength={40}
                  value={form.submitLabel}
                  onChange={(event) =>
                    updateForm(formIndex, (f) => ({
                      ...f,
                      submitLabel: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={styles.inlineLabel}>
                Self serve URL
                <input
                  className={styles.inputSmall}
                  type="url"
                  placeholder="https://example.com/signup"
                  value={form.selfServeUrl}
                  onChange={(event) =>
                    updateForm(formIndex, (f) => ({
                      ...f,
                      selfServeUrl: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <FieldErrors errors={formErrors?.form.length ? formErrors.form : undefined} />

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>HubSpot</legend>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={form.setHubspotOwner}
                  aria-describedby={`owner-help-${form.slug}`}
                  onChange={(event) =>
                    updateForm(formIndex, (f) => ({
                      ...f,
                      setHubspotOwner: event.target.checked,
                    }))
                  }
                />
                Set the HubSpot contact owner to the routed rep
              </label>
              <p id={`owner-help-${form.slug}`} className={styles.muted}>
                When a lead from this form goes to a rep, that rep becomes the owner of
                the lead&apos;s contact in HubSpot. Leads that go to self serve, the
                fallback queue, or a rep who isn&apos;t a HubSpot user keep their current
                owner.
              </p>
            </fieldset>

            <h4 className={styles.subheading}>Fields</h4>
            <ol className={styles.ruleRows}>
              {form.fields.map((field, index) => (
                <li key={field.id} className={styles.ruleRow}>
                  <div className={styles.ruleHeader}>
                    <span className={styles.muted}>{index + 1}.</span>
                    <span className={styles.rowName}>
                      {field.label || field.key || "Untitled field"}
                    </span>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.buttonSecondary}
                        aria-label={`Move ${field.label || field.key} up`}
                        disabled={index === 0}
                        onClick={() =>
                          updateForm(formIndex, (f) => ({
                            ...f,
                            fields: move(f.fields, index, index - 1),
                          }))
                        }
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        className={styles.buttonSecondary}
                        aria-label={`Move ${field.label || field.key} down`}
                        disabled={index === form.fields.length - 1}
                        onClick={() =>
                          updateForm(formIndex, (f) => ({
                            ...f,
                            fields: move(f.fields, index, index + 1),
                          }))
                        }
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        className={styles.buttonSecondary}
                        aria-label={`Remove ${field.label || field.key}`}
                        onClick={() =>
                          updateForm(formIndex, (f) => ({
                            ...f,
                            fields: f.fields.filter(
                              (candidate) => candidate.id !== field.id,
                            ),
                          }))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <FieldControls
                    field={field}
                    onChange={(change) => updateField(formIndex, field.id, change)}
                  />
                  <FieldErrors errors={formErrors?.fields.get(field.id)} />
                </li>
              ))}
            </ol>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={() =>
                  updateForm(formIndex, (f) => ({
                    ...f,
                    fields: [
                      ...f.fields,
                      newField(`new-field-${nextId.current++}`, f.fields),
                    ],
                  }))
                }
              >
                Add field
              </button>
            </div>

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Theme for this form</legend>
              <p className={styles.muted}>Empty settings use the default theme.</p>
              <ThemeControls
                theme={form.theme}
                onChange={(change) =>
                  updateForm(formIndex, (f) => ({
                    ...f,
                    theme: typeof change === "function" ? change(f.theme) : change,
                  }))
                }
                unsetLabel="Same as default"
              />
              <FieldErrors
                errors={formErrors?.theme.length ? formErrors.theme : undefined}
              />
            </fieldset>
          </section>
        );
      })}
    </>
  );
}

function FieldControls({
  field,
  onChange,
}: {
  field: FieldDraft;
  onChange: (change: (field: FieldDraft) => FieldDraft) => void;
}) {
  const name = field.label || field.key;
  return (
    <div className={styles.formGrid}>
      <label className={styles.inlineLabel}>
        Label
        <input
          className={styles.inputSmall}
          value={field.label}
          onChange={(event) => onChange((f) => ({ ...f, label: event.target.value }))}
        />
      </label>
      <label className={styles.inlineLabel}>
        Key
        <input
          className={`${styles.inputSmall} ${styles.mono}`}
          value={field.key}
          spellCheck={false}
          onChange={(event) => onChange((f) => ({ ...f, key: event.target.value }))}
        />
      </label>
      <label className={styles.inlineLabel}>
        Type
        <select
          className={styles.inputSmall}
          value={field.type}
          onChange={(event) =>
            onChange((f) => changeType(f, event.target.value as FormFieldType))
          }
        >
          {Object.entries(FIELD_TYPE_LABELS).map(([type, label]) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.checkLabel}>
        <input
          type="checkbox"
          checked={field.required}
          disabled={field.type === "consent"}
          title={
            field.type === "consent" ? "Consent fields are always required" : undefined
          }
          onChange={(event) =>
            onChange((f) => ({ ...f, required: event.target.checked }))
          }
        />
        Required
      </label>
      <label className={styles.inlineLabel}>
        Help text
        <input
          className={styles.inputSmall}
          placeholder="Shown below the field"
          maxLength={300}
          value={field.helpText}
          onChange={(event) => onChange((f) => ({ ...f, helpText: event.target.value }))}
        />
      </label>
      {field.type === "select" ? (
        <label className={styles.inlineLabel}>
          Options, one per line
          <textarea
            className={styles.inputSmall}
            rows={Math.min(Math.max(field.options.length, 3), 8)}
            aria-label={`Options for ${name}, one per line`}
            value={field.options.join("\n")}
            onChange={(event) =>
              onChange((f) => ({ ...f, options: event.target.value.split("\n") }))
            }
          />
        </label>
      ) : null}
    </div>
  );
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A color input needs #rrggbb; anything else (empty, transparent) shows black. */
function swatch(value: string): string {
  const hex = value.trim();
  if (!HEX_RE.test(hex)) return "#000000";
  return hex.length === 4
    ? `#${[...hex.slice(1)].map((c) => c + c).join("")}`.toLowerCase()
    : hex.toLowerCase();
}

/** The theme settings validateTheme knows, as simple inputs; empty means not set. */
function ThemeControls({
  theme,
  onChange,
  unsetLabel,
}: {
  theme: ThemeDraft;
  onChange: Dispatch<SetStateAction<ThemeDraft>>;
  /** What an empty setting means here. */
  unsetLabel: string;
}) {
  const set = (change: Partial<ThemeDraft>) =>
    onChange((current) => ({ ...current, ...change }));
  const color = (key: "accent" | "background", label: string, help?: string) => (
    <label className={styles.inlineLabel}>
      {label}
      <span className={styles.colorRow}>
        <input
          type="color"
          className={styles.colorInput}
          aria-label={`Pick ${label.toLowerCase()}`}
          value={swatch(theme[key])}
          onChange={(event) => set({ [key]: event.target.value.toUpperCase() })}
        />
        <input
          className={`${styles.inputSmall} ${styles.mono}`}
          aria-label={label}
          placeholder={unsetLabel}
          spellCheck={false}
          value={theme[key]}
          onChange={(event) => set({ [key]: event.target.value })}
        />
      </span>
      {help ? <span>{help}</span> : null}
    </label>
  );
  return (
    <div className={styles.formGrid}>
      {color("accent", "Accent color")}
      {color("background", "Page background", "A color, or transparent")}
      <label className={styles.inlineLabel}>
        Corner radius (px, 0 to 24)
        <input
          className={styles.inputSmall}
          type="number"
          min={0}
          max={24}
          placeholder={unsetLabel}
          value={theme.radius}
          onChange={(event) => set({ radius: event.target.value })}
        />
      </label>
      <label className={styles.inlineLabel}>
        Color scheme
        <select
          className={styles.inputSmall}
          value={theme.colorScheme}
          onChange={(event) =>
            set({ colorScheme: event.target.value as ThemeDraft["colorScheme"] })
          }
        >
          <option value="">{unsetLabel}</option>
          <option value="auto">Follow the visitor&apos;s setting</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className={styles.inlineLabel}>
        Layout
        <select
          className={styles.inputSmall}
          value={theme.layout}
          onChange={(event) =>
            set({ layout: event.target.value as ThemeDraft["layout"] })
          }
        >
          <option value="">{unsetLabel}</option>
          <option value="card">Card (bordered panel)</option>
          <option value="plain">Plain (fields only)</option>
        </select>
      </label>
      <label className={styles.inlineLabel}>
        Font
        <input
          className={styles.inputSmall}
          placeholder={`${unsetLabel}, or Georgia, serif`}
          value={theme.fontFamily}
          onChange={(event) => set({ fontFamily: event.target.value })}
        />
      </label>
      <label className={styles.inlineLabel}>
        Font stylesheet URL
        <input
          className={styles.inputSmall}
          type="url"
          placeholder="https://fonts.googleapis.com/css2?family=…"
          value={theme.fontStylesheet}
          onChange={(event) => set({ fontStylesheet: event.target.value })}
        />
      </label>
    </div>
  );
}
