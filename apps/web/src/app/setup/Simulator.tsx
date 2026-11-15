"use client";

import type { ConfigInput } from "@switchboard/config";
import { URL_PARAMS, type FormField } from "@switchboard/core/client";
import { useEffect, useState } from "react";
import type { CampaignParam, Simulation, TestLead } from "@/lib/simulate";
import styles from "../admin.module.css";

/** The campaign fields a test lead can carry (last visit). */
const UTM_PARAMS = URL_PARAMS.filter((param): param is CampaignParam =>
  param.startsWith("utm_"),
);

/** Saved test leads live in this browser only; they are never sent to be stored. */
const STORAGE_KEY = "switchboard.testLeads";

type SavedLead = { name: string; form: string; lead: TestLead };

const EMPTY_LEAD: TestLead = { answers: {}, hubspotOwner: "", utm: {} };

type Result =
  { kind: "routed"; simulation: Simulation } | { kind: "failed"; errors: string[] };

function readSaved(): SavedLead[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(saved) ? (saved as SavedLead[]) : [];
  } catch {
    return [];
  }
}

/**
 * Route a test lead through the rules as currently edited (not as saved),
 * with the real rules engine on the server. Nothing is saved and no lead is
 * created; the draft isn't applied.
 */
export default function Simulator({
  forms,
  draftConfig,
}: {
  forms: { slug: string; name: string; fields: FormField[] }[];
  /** The config as currently edited. */
  draftConfig: () => ConfigInput;
}) {
  const [formSlug, setFormSlug] = useState(forms[0]?.slug ?? "");
  const [lead, setLead] = useState<TestLead>(EMPTY_LEAD);
  const [saved, setSaved] = useState<SavedLead[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // Read after hydration: the server has no saved leads.
  useEffect(() => setSaved(readSaved()), []);

  const form = forms.find((candidate) => candidate.slug === formSlug) ?? forms[0];
  if (!form) return null;
  const savedHere = saved.filter((entry) => entry.form === form.slug);

  const store = (next: SavedLead[]) => {
    setSaved(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or blocked: the list still works until the page reloads.
    }
  };
  const saveLead = () => {
    const name =
      form.fields.map((field) => lead.answers[field.key]?.trim()).find(Boolean) ||
      `Test lead ${savedHere.length + 1}`;
    store([
      ...saved.filter((entry) => !(entry.form === form.slug && entry.name === name)),
      { name, form: form.slug, lead },
    ]);
  };
  const setAnswer = (key: string, value: string) =>
    setLead((current) => ({ ...current, answers: { ...current.answers, [key]: value } }));

  const simulate = async () => {
    setRunning(true);
    try {
      const response = await fetch("/api/admin/config/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: draftConfig(), form: form.slug, lead }),
      });
      const payload = (await response.json().catch(() => null)) as
        (Simulation & { errors?: unknown }) | null;
      if (response.ok && payload) setResult({ kind: "routed", simulation: payload });
      else {
        setResult({
          kind: "failed",
          errors: Array.isArray(payload?.errors)
            ? (payload.errors as string[])
            : [`Simulating failed (HTTP ${response.status}). Try again.`],
        });
      }
    } catch {
      setResult({
        kind: "failed",
        errors: ["The server couldn't be reached. Check your connection and try again."],
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    // One grid cell beside the rules.
    <div>
      <h2 id="simulator-heading" className={styles.groupTitle}>
        Simulator
      </h2>
      <section className={styles.section} aria-labelledby="simulator-heading">
        <p className={styles.sectionBody}>
          Try a lead against the rules as edited, before saving. Nothing is saved and no
          lead is created.
        </p>
        <div className={styles.cellStack}>
          {forms.length > 1 ? (
            <label className={styles.inlineLabel}>
              Form
              <select
                className={styles.inputSmall}
                value={form.slug}
                onChange={(event) => {
                  setFormSlug(event.target.value);
                  setLead(EMPTY_LEAD);
                  setResult(null);
                }}
              >
                {forms.map((candidate) => (
                  <option key={candidate.slug} value={candidate.slug}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {savedHere.length > 0 ? (
            <label className={styles.inlineLabel}>
              Saved test lead
              <select
                className={styles.inputSmall}
                value=""
                onChange={(event) => {
                  const picked = savedHere.find(
                    (entry) => entry.name === event.target.value,
                  );
                  if (picked) setLead({ ...EMPTY_LEAD, ...picked.lead });
                }}
              >
                <option value="">Pick one to fill in the lead</option>
                {savedHere.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Form answers</legend>
            {form.fields.map((field) => (
              <AnswerInput
                key={field.key}
                field={field}
                value={lead.answers[field.key] ?? ""}
                onChange={(value) => setAnswer(field.key, value)}
              />
            ))}
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>HubSpot and campaign</legend>
            <label className={styles.inlineLabel}>
              HubSpot contact owner (email)
              <input
                className={styles.inputSmall}
                type="email"
                placeholder="None"
                value={lead.hubspotOwner}
                onChange={(event) =>
                  setLead({ ...lead, hubspotOwner: event.target.value })
                }
              />
            </label>
            {UTM_PARAMS.map((param) => (
              <label key={param} className={styles.inlineLabel}>
                {param}
                <input
                  className={styles.inputSmall}
                  value={lead.utm[param] ?? ""}
                  onChange={(event) =>
                    setLead({
                      ...lead,
                      utm: { ...lead.utm, [param]: event.target.value },
                    })
                  }
                />
              </label>
            ))}
          </fieldset>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            onClick={simulate}
            disabled={running}
          >
            {running ? "Simulating…" : "Simulate lead"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={saveLead}>
            Save test lead
          </button>
          {savedHere.length > 0 ? (
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={() => store(saved.filter((entry) => entry.form !== form.slug))}
            >
              Forget saved leads
            </button>
          ) : null}
        </div>

        <div aria-live="polite">
          {result?.kind === "routed" ? (
            <div className={styles.simulation}>
              <p>{result.simulation.summary}</p>
              {result.simulation.trace.length > 0 ? (
                <>
                  <h4 className={styles.legend}>Rules tried</h4>
                  <ol className={styles.trace}>
                    {result.simulation.trace.map((step) => (
                      <li key={step.position}>
                        <span className={styles.mono}>{step.position}.</span> {step.rule}:{" "}
                        {step.matched ? (
                          <strong>matched</strong>
                        ) : (
                          <span className={styles.muted}>
                            no match ({step.failedOnLabel ?? step.failedOn} didn&apos;t
                            match)
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
            </div>
          ) : null}
          {result?.kind === "failed" ? (
            <div className={styles.bannerError} role="alert">
              The edited config has problems, so this lead can&apos;t be simulated. Fix
              them and try again:
              <ul className={styles.errorList}>
                {result.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function AnswerInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.type === "consent") {
    return (
      <label className={styles.checkLabel}>
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(event) => onChange(event.target.checked ? "true" : "")}
        />
        {field.label}
      </label>
    );
  }
  return (
    <label className={styles.inlineLabel}>
      {field.label}
      {field.type === "select" ? (
        <select
          className={styles.inputSmall}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">No answer</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={styles.inputSmall}
          type={field.type === "email" ? "email" : "text"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
