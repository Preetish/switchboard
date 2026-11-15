"use client";

import { useEffect, useRef } from "react";
import styles from "../admin.module.css";
import type { ChangeGroup, DiffLine } from "./review";

const DIFF_PREFIX = { same: "  ", added: "+ ", removed: "- " } as const;

/**
 * The step between Save changes and applying: what the save changes, in
 * words, and (collapsed) the switchboard.yaml diff. The config shown here
 * already passed the same checks as the apply path; Apply changes sends it.
 */
export default function ReviewPanel({
  groups,
  warnings,
  diff,
  applying,
  onApply,
  onBack,
}: {
  groups: ChangeGroup[];
  /** The validator's warnings for the draft (it can still be applied). */
  warnings: string[];
  diff: DiffLine[];
  applying: boolean;
  onApply: () => void;
  onBack: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <section className={styles.section} aria-labelledby="review-heading">
      <h2 id="review-heading" ref={heading} tabIndex={-1} className={styles.sectionTitle}>
        Review changes
      </h2>
      <p className={styles.sectionBody}>
        The edited config passed every check. Nothing changes until you apply it, and new
        leads route with it right after.
      </p>
      {groups.length === 0 ? (
        <p className={styles.subheading}>
          No changes. Applying saves the same config again.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.title}>
            <h3 className={styles.subheading}>{group.title}</h3>
            <ul className={styles.changeList}>
              {group.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </div>
        ))
      )}
      {warnings.length > 0 ? (
        <>
          <h3 className={styles.subheading}>Worth knowing</h3>
          <ul className={styles.changeList}>
            {warnings.map((warning) => (
              <li key={warning} className={styles.warning}>
                <span className={styles.dotWarn} aria-hidden="true" />
                {warning}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {diff.length > 0 ? (
        <details className={styles.details}>
          <summary>
            YAML diff{" "}
            <span className={styles.muted}>(switchboard.yaml, saved → edited)</span>
          </summary>
          <pre className={styles.diff}>
            {diff.map((line, index) =>
              line.kind === "skipped" ? (
                <span key={index} className={styles.diffSkipped}>
                  {`  … ${line.count} unchanged line${line.count === 1 ? "" : "s"}`}
                </span>
              ) : (
                <span
                  key={index}
                  className={
                    line.kind === "added"
                      ? styles.diffAdded
                      : line.kind === "removed"
                        ? styles.diffRemoved
                        : styles.diffLine
                  }
                >
                  {`${DIFF_PREFIX[line.kind]}${line.text}`}
                </span>
              ),
            )}
          </pre>
        </details>
      ) : null}
      <p className={styles.footnote}>
        Applying <code className={styles.code}>switchboard.yaml</code> again later
        replaces these changes, so download the YAML after applying if you keep the file.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={onApply}
          disabled={applying}
        >
          {applying ? "Applying…" : "Apply changes"}
        </button>
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={onBack}
          disabled={applying}
        >
          Back to editing
        </button>
      </div>
    </section>
  );
}
