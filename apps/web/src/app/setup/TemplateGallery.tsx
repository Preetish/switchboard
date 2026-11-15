"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../admin.module.css";
import { TEMPLATES, type Template } from "./templates";

/**
 * Pick a template to start the draft from. When the draft already has
 * reps, teams, rules, or more than one form, a warning asks before
 * replacing it, and Cancel leaves it untouched. Loading a template only
 * changes the drafts; nothing is saved until Save changes.
 */
export default function TemplateGallery({
  hasSetup,
  loaded,
  onLoad,
}: {
  /** Whether replacing the draft loses work (see hasExistingSetup). */
  hasSetup: boolean;
  /** The template the drafts were last loaded from, until the next save. */
  loaded: Template | null;
  onLoad: (template: Template) => void;
}) {
  const [pending, setPending] = useState<Template | null>(null);
  const warning = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pending) warning.current?.focus();
  }, [pending]);

  const load = (template: Template) => {
    onLoad(template);
    setPending(null);
  };

  return (
    <>
      <h2 className={styles.groupTitle}>Templates</h2>
      <section className={styles.section} aria-labelledby="templates-heading">
        <h3 id="templates-heading" className={styles.sectionTitle}>
          Start from a template
        </h3>
        <p className={styles.sectionBody}>
          A template fills the editors below with placeholder reps, teams, one form, and
          its rules. Swap each placeholder for a real rep, then save changes to review and
          apply it. Nothing changes until you apply.
        </p>
        <ul className={styles.templateGrid}>
          {TEMPLATES.map((template) => (
            <li key={template.id} className={styles.templateCard}>
              <h4 className={styles.rowName}>{template.name}</h4>
              <p className={styles.muted}>{template.description}</p>
              <div>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  aria-label={`Use the ${template.name} template`}
                  onClick={() => (hasSetup ? setPending(template) : load(template))}
                >
                  Use template
                </button>
              </div>
            </li>
          ))}
        </ul>

        {pending ? (
          <div ref={warning} tabIndex={-1} className={styles.bannerError} role="alert">
            <p>
              Replace your draft with the {pending.name} template? Its teams, form, and
              rules replace the ones below, including unsaved edits, and your reps stay
              listed with no teams. Your saved setup stays as it is until you save changes
              and apply them.
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.button}
                onClick={() => load(pending)}
              >
                Replace draft
              </button>
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <p aria-live="polite" className={styles.footnote}>
          {loaded && !pending
            ? `Loaded the ${loaded.name} template. Nothing is saved yet: swap each placeholder rep for a HubSpot owner, or add one of your reps to its team and remove the placeholder, then save changes to review it.`
            : null}
        </p>
      </section>
    </>
  );
}
