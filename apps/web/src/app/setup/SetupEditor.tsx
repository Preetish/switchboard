"use client";

import type { ApplySummary, ConfigInput, ConfigPlan } from "@switchboard/config";
import type { FormField } from "@switchboard/core/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "../admin.module.css";
import RepsTeamsEditor, { type CalendarStatus } from "./RepsTeamsEditor";
import ReviewPanel from "./ReviewPanel";
import { describeChanges, diffLines, type ChangeGroup, type DiffLine } from "./review";
import RuleBuilder from "./RuleBuilder";
import Simulator from "./Simulator";
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
  type FormRulesDraft,
  type PlacedRuleErrors,
} from "./rules";

type SaveErrors = { repsTeams: PlacedErrors; rules: PlacedRuleErrors };
type SaveResult =
  | { kind: "saved"; summary: ApplySummary }
  | { kind: "rolled-back" }
  | { kind: "failed"; errors: SaveErrors };
/** A draft that passed the checks, waiting on the review screen. */
type Review = {
  config: ConfigInput;
  sentRules: (FormRulesDraft | null)[];
  groups: ChangeGroup[];
  warnings: string[];
  diff: DiffLine[];
  /** The draft as switchboard.yaml. */
  yaml: string;
};
/**
 * What Roll back needs, kept in this tab's session storage so it survives a
 * reload: the config before the last save, and that save's YAML. Roll back
 * is offered only while the saved config is still exactly what that save
 * applied, so it never undoes a change made since (say, by config:apply).
 */
type Rollback = { config: ConfigInput; appliedYaml: string };
const ROLLBACK_KEY = "switchboard.rollback";

function storeRollback(rollback: Rollback | null) {
  try {
    if (rollback) sessionStorage.setItem(ROLLBACK_KEY, JSON.stringify(rollback));
    else sessionStorage.removeItem(ROLLBACK_KEY);
  } catch {
    // Storage blocked or full: Roll back still works until the page reloads.
  }
}

function savedMessage(summary: ApplySummary): string {
  const added = summary.reps.created;
  return `Saved.${added > 0 ? ` Added ${added} rep${added === 1 ? "" : "s"}.` : ""} Changes apply to new leads.`;
}

/** POST a config object to `url`: the body on success, else the errors to show. */
async function postConfig<T>(
  url: string,
  config: ConfigInput,
  action: string,
): Promise<{ ok: true; body: T } | { ok: false; errors: string[] }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    const payload = (await response.json().catch(() => null)) as
      (T & { errors?: unknown }) | null;
    if (response.ok && payload) return { ok: true, body: payload };
    return {
      ok: false,
      errors: Array.isArray(payload?.errors)
        ? (payload.errors as string[])
        : [`${action} failed (HTTP ${response.status}). Nothing was changed; try again.`],
    };
  } catch {
    return {
      ok: false,
      errors: [
        "The server couldn't be reached. Nothing was changed; check your connection and try again.",
      ],
    };
  }
}

/**
 * The Setup page's editors (reps and teams, and each form's rules, with the
 * simulator beside the rules) and the one Save changes flow: the whole
 * config (forms, theme, and everything not edited here as loaded) is checked
 * by POST /api/admin/config/check, the review screen shows what changes,
 * and Apply changes sends it to POST /api/admin/config/apply. A config with
 * any problem is not applied; its errors show next to the rep, team, or rule
 * they name, and the rest in a list at the top. After a save, Roll back
 * last save applies the config as it was before it, the same way.
 */
export default function SetupEditor({
  config,
  plan,
  yaml,
  calendars,
}: {
  /** The current config as getCurrentConfigPlan and toConfigObject read it. */
  config: ConfigInput;
  /** The same config as a plan, and as switchboard.yaml, to compare a draft with. */
  plan: ConfigPlan;
  yaml: string;
  /** Calendar status by lowercased rep email. */
  calendars: Record<string, CalendarStatus>;
}) {
  const router = useRouter();
  const [base, setBase] = useState(config);
  const [reps, setReps] = useState(() => draftsFromConfig(config).reps);
  const [teams, setTeams] = useState(() => draftsFromConfig(config).teams);
  const [ruleForms, setRuleForms] = useState(() => rulesDraftsFromConfig(config));
  const [busy, setBusy] = useState<"checking" | "applying" | "rolling-back" | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [rollback, setRollback] = useState<Rollback | null>(null);

  // Read after hydration: the server has no session storage.
  useEffect(() => {
    try {
      setRollback(
        JSON.parse(sessionStorage.getItem(ROLLBACK_KEY) ?? "null") as Rollback | null,
      );
    } catch {
      setRollback(null);
    }
  }, []);
  const canRollBack = rollback !== null && rollback.appliedYaml === yaml;

  // After a save, the page data is refreshed: start over from what was saved.
  if (config !== base) {
    const drafts = draftsFromConfig(config);
    setBase(config);
    setReps(drafts.reps);
    setTeams(drafts.teams);
    setRuleForms(rulesDraftsFromConfig(config));
  }

  const draftConfig = () => buildRulesConfig(buildConfig(base, reps, teams), ruleForms);

  // Errors name rules by position, so place them against the drafts that were sent.
  const failed = (errors: string[], sentRules: (FormRulesDraft | null)[]) => {
    const repsTeams = placeErrors(errors);
    const rules = placeRuleErrors(repsTeams.other, sentRules);
    setResult({ kind: "failed", errors: { repsTeams, rules } });
  };

  /** Save changes: check the whole draft, then show the review screen. */
  const save = async () => {
    const sentRules = ruleForms;
    const draft = draftConfig();
    setBusy("checking");
    setResult(null);
    const checked = await postConfig<{
      plan: ConfigPlan;
      yaml: string;
      warnings: string[];
    }>("/api/admin/config/check", draft, "Checking");
    setBusy(null);
    if (!checked.ok) return failed(checked.errors, sentRules);
    setReview({
      config: draft,
      sentRules,
      groups: describeChanges(plan, checked.body.plan),
      warnings: checked.body.warnings,
      diff: diffLines(yaml, checked.body.yaml),
      yaml: checked.body.yaml,
    });
  };

  /** Apply changes: the reviewed config, through the apply path, in one transaction. */
  const apply = async () => {
    if (!review) return;
    setBusy("applying");
    const applied = await postConfig<ApplySummary>(
      "/api/admin/config/apply",
      review.config,
      "Saving",
    );
    setBusy(null);
    setReview(null);
    if (!applied.ok) return failed(applied.errors, review.sentRules);
    const next = { config: base, appliedYaml: review.yaml };
    setRollback(next);
    storeRollback(next);
    setResult({ kind: "saved", summary: applied.body });
    router.refresh();
  };

  /** Roll back: apply the config as it was before the last save. */
  const rollBack = async () => {
    if (!rollback) return;
    setBusy("rolling-back");
    const applied = await postConfig<ApplySummary>(
      "/api/admin/config/apply",
      rollback.config,
      "Rolling back",
    );
    setBusy(null);
    if (!applied.ok) return failed(applied.errors, []);
    setRollback(null);
    storeRollback(null);
    setResult({ kind: "rolled-back" });
    router.refresh();
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

      {review ? (
        <ReviewPanel
          groups={review.groups}
          warnings={review.warnings}
          diff={review.diff}
          applying={busy === "applying"}
          onApply={apply}
          onBack={() => setReview(null)}
        />
      ) : null}

      {/* Hidden, not unmounted, while reviewing: the editors keep their state. */}
      <div hidden={review !== null}>
        <RepsTeamsEditor
          reps={reps}
          teams={teams}
          setReps={setReps}
          setTeams={setTeams}
          errors={errors?.repsTeams ?? null}
          calendars={calendars}
        />
        <div className={styles.rulesLayout}>
          <div>
            <RuleBuilder
              forms={ruleForms}
              setForms={setRuleForms}
              reps={reps}
              teams={teams}
              errors={errors?.rules ?? null}
            />
          </div>
          <Simulator
            forms={base.forms.map((form) => ({
              slug: form.slug,
              name: form.name,
              fields: form.fields as FormField[],
            }))}
            draftConfig={draftConfig}
          />
        </div>

        <div className={styles.saveBar}>
          <button
            type="button"
            className={styles.button}
            onClick={save}
            disabled={busy !== null}
          >
            {busy === "checking" ? "Checking…" : "Save changes"}
          </button>
          <span aria-live="polite" className={styles.muted}>
            {result?.kind === "saved" ? savedMessage(result.summary) : null}
            {result?.kind === "rolled-back"
              ? "Rolled back to the config before your last save. Changes apply to new leads."
              : null}
            {result?.kind === "failed"
              ? "Nothing was saved. Fix the problems shown and save again."
              : null}
          </span>
          {canRollBack ? (
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={rollBack}
              disabled={busy !== null}
            >
              {busy === "rolling-back" ? "Rolling back…" : "Roll back last save"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
