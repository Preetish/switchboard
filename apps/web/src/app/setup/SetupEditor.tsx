"use client";

import type { ApplySummary, ConfigInput } from "@switchboard/config";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "../admin.module.css";
import RepsTeamsEditor, { type CalendarStatus } from "./RepsTeamsEditor";
import RuleBuilder from "./RuleBuilder";
import {
  buildConfig,
  draftsFromConfig,
  placeErrors,
  type PlacedErrors,
} from "./reps-teams";
import {
  buildRulesConfig,
  placeRuleErrors,
  rulesDraftsFromConfig,
  type PlacedRuleErrors,
} from "./rules";

type SaveErrors = { repsTeams: PlacedErrors; rules: PlacedRuleErrors };
type SaveResult =
  { kind: "saved"; summary: ApplySummary } | { kind: "failed"; errors: SaveErrors };

function savedMessage(summary: ApplySummary): string {
  const added = summary.reps.created;
  return `Saved.${added > 0 ? ` Added ${added} rep${added === 1 ? "" : "s"}.` : ""} Changes apply to new leads.`;
}

/**
 * The Setup page's editors (reps and teams, and each form's rules) with one
 * Save changes: it sends the whole config (forms, theme, and everything not
 * edited here as loaded) to POST /api/admin/config/apply. A config with any
 * problem is not applied; its errors show next to the rep, team, or rule
 * they name, and the rest in a list at the top.
 */
export default function SetupEditor({
  config,
  calendars,
}: {
  /** The current config as getCurrentConfigPlan and toConfigObject read it. */
  config: ConfigInput;
  /** Calendar status by lowercased rep email. */
  calendars: Record<string, CalendarStatus>;
}) {
  const router = useRouter();
  const [base, setBase] = useState(config);
  const [reps, setReps] = useState(() => draftsFromConfig(config).reps);
  const [teams, setTeams] = useState(() => draftsFromConfig(config).teams);
  const [ruleForms, setRuleForms] = useState(() => rulesDraftsFromConfig(config));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  // After a save, the page data is refreshed: start over from what was saved.
  if (config !== base) {
    const drafts = draftsFromConfig(config);
    setBase(config);
    setReps(drafts.reps);
    setTeams(drafts.teams);
    setRuleForms(rulesDraftsFromConfig(config));
  }

  const save = async () => {
    // Errors name rules by position, so place them against what was sent.
    const sentRules = ruleForms;
    const failed = (errors: string[]) => {
      const repsTeams = placeErrors(errors);
      const rules = placeRuleErrors(repsTeams.other, sentRules);
      setResult({ kind: "failed", errors: { repsTeams, rules } });
    };
    setSaving(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/config/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildRulesConfig(buildConfig(base, reps, teams), sentRules)),
      });
      const payload = (await response.json().catch(() => null)) as
        (ApplySummary & { errors?: unknown }) | null;
      if (response.ok && payload) {
        setResult({ kind: "saved", summary: payload });
        router.refresh();
      } else {
        failed(
          Array.isArray(payload?.errors)
            ? (payload.errors as string[])
            : [
                `Saving failed (HTTP ${response.status}). Nothing was changed; try again.`,
              ],
        );
      }
    } catch {
      failed([
        "The server couldn't be reached. Nothing was changed; check your connection and try again.",
      ]);
    } finally {
      setSaving(false);
    }
  };

  const errors = result?.kind === "failed" ? result.errors : null;

  return (
    // Its own box, so the sticky save bar stays with the editors.
    <div>
      {errors && errors.rules.other.length > 0 ? (
        <div className={styles.bannerError} role="alert">
          These problems stopped the save:
          <ul className={styles.errorList}>
            {errors.rules.other.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <RepsTeamsEditor
        reps={reps}
        teams={teams}
        setReps={setReps}
        setTeams={setTeams}
        errors={errors?.repsTeams ?? null}
        calendars={calendars}
      />
      <RuleBuilder
        forms={ruleForms}
        setForms={setRuleForms}
        reps={reps}
        teams={teams}
        errors={errors?.rules ?? null}
      />

      <div className={styles.saveBar}>
        <button type="button" className={styles.button} onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <span aria-live="polite" className={styles.muted}>
          {result?.kind === "saved" ? savedMessage(result.summary) : null}
          {result?.kind === "failed"
            ? "Nothing was saved. Fix the problems shown and save again."
            : null}
        </span>
      </div>
    </div>
  );
}
