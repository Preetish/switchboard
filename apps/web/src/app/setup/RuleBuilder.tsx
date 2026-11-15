"use client";

import type { RouteAction, WhenClause } from "@switchboard/core";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import styles from "../admin.module.css";
import { FieldErrors } from "./RepsTeamsEditor";
import type { RepDraft, TeamDraft } from "./reps-teams";
import {
  OPERATOR_LABELS,
  STRATEGY_LABELS,
  changeSource,
  move,
  newRule,
  routeFromKey,
  routeKey,
  routeOptions,
  ruleWarnings,
  sourcesFor,
  type FormRulesDraft,
  type Operator,
  type PlacedRuleErrors,
  type RouteOption,
  type RuleDraft,
  type Sentence,
  type Source,
} from "./rules";

type Forms = (FormRulesDraft | null)[];

/**
 * Each form's rules as sentences, top to bottom: the first match wins, and
 * the fallback is the fixed last row. Drag a rule's handle (or use Move up
 * and Move down) to reorder. Rules only YAML can express stay as written.
 */
export default function RuleBuilder({
  forms,
  setForms,
  reps,
  teams,
  errors,
}: {
  forms: Forms;
  setForms: Dispatch<SetStateAction<Forms>>;
  /** The reps and teams as currently edited, for route targets. */
  reps: RepDraft[];
  teams: TeamDraft[];
  /** From the last failed save. */
  errors: PlacedRuleErrors | null;
}) {
  const nextId = useRef(0);
  const [dragging, setDragging] = useState<{ formIndex: number; ruleId: string } | null>(
    null,
  );

  const updateForm = (
    formIndex: number,
    change: (form: FormRulesDraft) => FormRulesDraft,
  ) =>
    setForms((current) =>
      current.map((form, i) => (i === formIndex && form ? change(form) : form)),
    );
  const updateRule = (formIndex: number, id: string, change: Partial<RuleDraft>) =>
    updateForm(formIndex, (form) => ({
      ...form,
      rules: form.rules.map((rule) => (rule.id === id ? { ...rule, ...change } : rule)),
    }));
  const moveRule = (formIndex: number, from: number, to: number) =>
    updateForm(formIndex, (form) => ({ ...form, rules: move(form.rules, from, to) }));

  const repOptions = reps.map((rep) => ({ email: rep.email, name: rep.name }));
  const teamOptions = teams.map((team) => ({ key: team.key, name: team.name }));

  return (
    <>
      <h2 className={styles.groupTitle}>Rules</h2>
      <p className={styles.sectionBody}>
        Rules run top to bottom and the first match wins; a lead no rule matches goes to
        the last row. Drag a rule by its handle, or use Move up and Move down, to change
        the order. Rules with more than one condition or a regular expression are
        advanced: change their conditions in{" "}
        <code className={styles.code}>switchboard.yaml</code>.
      </p>
      {forms.map((form, formIndex) => {
        if (!form) return null;
        const warnings = ruleWarnings(form.rules);
        const sources = sourcesFor(form.fields);
        return (
          <section
            key={form.slug}
            className={styles.section}
            aria-labelledby={`rules-${form.slug}`}
          >
            <h3 id={`rules-${form.slug}`} className={styles.sectionTitle}>
              {form.name} <span className={styles.muted}>· /f/{form.slug}</span>
            </h3>
            {form.rules.length === 0 ? (
              <p className={styles.sectionBody}>
                No rules yet. Every lead goes to the last row.
              </p>
            ) : null}
            <ol className={styles.ruleRows}>
              {form.rules.map((rule, index) => (
                <li
                  key={rule.id}
                  className={
                    dragging?.ruleId === rule.id ? styles.ruleRowDragging : styles.ruleRow
                  }
                  onDragOver={(event) => {
                    if (dragging?.formIndex === formIndex) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging?.formIndex !== formIndex) return;
                    moveRule(
                      formIndex,
                      form.rules.findIndex((r) => r.id === dragging.ruleId),
                      index,
                    );
                    setDragging(null);
                  }}
                >
                  <div className={styles.ruleHeader}>
                    <span
                      className={styles.dragHandle}
                      draggable
                      title="Drag to reorder"
                      aria-hidden="true"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", rule.name);
                        const row = event.currentTarget.closest("li");
                        if (row) event.dataTransfer.setDragImage(row, 16, 16);
                        setDragging({ formIndex, ruleId: rule.id });
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      ≡
                    </span>
                    <span className={styles.muted}>{index + 1}.</span>
                    <input
                      className={styles.inputSmall}
                      value={rule.name}
                      aria-label={`Name of rule ${index + 1}`}
                      onChange={(event) =>
                        updateRule(formIndex, rule.id, { name: event.target.value })
                      }
                    />
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.buttonSecondary}
                        aria-label={`Move ${rule.name} up`}
                        disabled={index === 0}
                        onClick={() => moveRule(formIndex, index, index - 1)}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        className={styles.buttonSecondary}
                        aria-label={`Move ${rule.name} down`}
                        disabled={index === form.rules.length - 1}
                        onClick={() => moveRule(formIndex, index, index + 1)}
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        className={styles.buttonSecondary}
                        aria-label={`Remove ${rule.name}`}
                        onClick={() =>
                          updateForm(formIndex, (current) => ({
                            ...current,
                            rules: current.rules.filter((r) => r.id !== rule.id),
                          }))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className={styles.sentence}>
                    <span>When</span>
                    {"advanced" in rule.when ? (
                      <AdvancedWhen when={rule.when.advanced} />
                    ) : (
                      <SentenceControls
                        id={rule.id}
                        label={rule.name}
                        sentence={rule.when}
                        sources={sources}
                        reps={repOptions}
                        onChange={(when) => updateRule(formIndex, rule.id, { when })}
                      />
                    )}
                    <span>then route to</span>
                    <RouteControls
                      label={rule.name}
                      route={rule.route}
                      options={routeOptions(repOptions, teamOptions, rule.route, {
                        fallback: false,
                      })}
                      onChange={(route) => updateRule(formIndex, rule.id, { route })}
                    />
                  </div>
                  {warnings.has(rule.id) ? (
                    <p className={styles.warning}>
                      <span className={styles.dotWarn} aria-hidden="true" />
                      {warnings.get(rule.id)}
                    </p>
                  ) : null}
                  <FieldErrors errors={errors?.rules.get(rule.id)} />
                </li>
              ))}
              <li className={styles.ruleRow}>
                <div className={styles.sentence}>
                  <strong>Otherwise</strong>
                  <span>route to</span>
                  <RouteControls
                    label="the fallback"
                    route={form.fallback}
                    options={routeOptions(repOptions, teamOptions, form.fallback, {
                      fallback: true,
                    })}
                    onChange={(fallback) =>
                      updateForm(formIndex, (current) => ({ ...current, fallback }))
                    }
                  />
                </div>
                <p className={styles.muted}>
                  Always last: leads no rule matches go here.
                </p>
                <FieldErrors errors={errors?.fallbacks.get(formIndex)} />
              </li>
            </ol>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={() =>
                  updateForm(formIndex, (current) => ({
                    ...current,
                    rules: [
                      ...current.rules,
                      newRule(
                        `new-rule-${nextId.current++}`,
                        current,
                        teams.map((team) => team.key),
                      ),
                    ],
                  }))
                }
              >
                Add rule
              </button>
            </div>
          </section>
        );
      })}
    </>
  );
}

/** Conditions only switchboard.yaml can change, shown as written. */
function AdvancedWhen({ when }: { when: WhenClause }) {
  return (
    <span className={styles.advanced}>
      <code className={styles.code}>
        {Object.entries(when)
          .map(([path, condition]) => `${path}: ${JSON.stringify(condition)}`)
          .join(", ")}
      </code>{" "}
      <span className={styles.muted}>(advanced: edit in switchboard.yaml)</span>
    </span>
  );
}

function SentenceControls({
  id,
  label,
  sentence,
  sources,
  reps,
  onChange,
}: {
  /** Unique on the page, for the value's suggestion list. */
  id: string;
  label: string;
  sentence: Sentence;
  sources: Source[];
  reps: { email: string; name: string }[];
  onChange: (sentence: Sentence) => void;
}) {
  const source = sources.find((candidate) => candidate.id === sentence.source);
  const groups = [...new Set(sources.map((candidate) => candidate.group))];
  const value = (props: {
    "aria-label": string;
    placeholder?: string;
    list?: string;
    inputMode?: "decimal";
  }) => (
    <input
      className={styles.inputSmall}
      value={sentence.value}
      onChange={(event) => onChange({ ...sentence, value: event.target.value })}
      {...props}
    />
  );
  const ownerEmails = reps.map((rep) => rep.email.trim().toLowerCase()).filter(Boolean);

  return (
    <>
      <select
        className={styles.inputSmall}
        aria-label={`What ${label} checks`}
        value={sentence.source}
        onChange={(event) => {
          const next = sources.find((candidate) => candidate.id === event.target.value);
          if (next) onChange(changeSource(sentence, next));
        }}
      >
        {groups.map((group) => {
          const options = sources
            .filter((candidate) => candidate.group === group)
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ));
          return group ? (
            <optgroup key={group} label={group}>
              {options}
            </optgroup>
          ) : (
            options
          );
        })}
      </select>
      {source && source.operators.length > 1 ? (
        <select
          className={styles.inputSmall}
          aria-label={`How ${label} compares`}
          value={sentence.operator}
          onChange={(event) => {
            const operator = event.target.value as Operator;
            onChange({
              ...sentence,
              operator,
              value: operator === "exists" ? "" : sentence.value,
            });
          }}
        >
          {source.operators.map((operator) => (
            <option key={operator} value={operator}>
              {OPERATOR_LABELS[operator]}
            </option>
          ))}
        </select>
      ) : source?.kind === "email_type" ? (
        <span>is</span>
      ) : null}
      {source?.kind === "email_type" ? (
        <select
          className={styles.inputSmall}
          aria-label={`Email type for ${label}`}
          value={sentence.value}
          onChange={(event) => onChange({ ...sentence, value: event.target.value })}
        >
          <option value="free">free (personal)</option>
          <option value="work">work</option>
        </select>
      ) : source?.kind === "owner" && sentence.operator === "is" ? (
        <select
          className={styles.inputSmall}
          aria-label={`Rep for ${label}`}
          value={sentence.value}
          onChange={(event) => onChange({ ...sentence, value: event.target.value })}
        >
          <option value="">Choose a rep</option>
          {[
            ...new Set([...ownerEmails, ...(sentence.value ? [sentence.value] : [])]),
          ].map((email) => (
            <option key={email} value={email}>
              {reps.find((rep) => rep.email.trim().toLowerCase() === email)?.name ||
                email}
            </option>
          ))}
        </select>
      ) : sentence.operator === "exists" ||
        source?.kind === "any" ? null : sentence.operator === "any_of" ? (
        value({
          "aria-label": `Values for ${label}, separated by commas`,
          placeholder: "Germany, Austria",
        })
      ) : sentence.operator === "at_least" ? (
        value({
          "aria-label": `Number for ${label}`,
          placeholder: "500",
          inputMode: "decimal",
        })
      ) : (
        <>
          {value({
            "aria-label": `Value for ${label}`,
            ...(source?.options ? { list: `options-${id}` } : {}),
          })}
          {source?.options ? (
            <datalist id={`options-${id}`}>
              {source.options.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          ) : null}
        </>
      )}
    </>
  );
}

function RouteControls({
  label,
  route,
  options,
  onChange,
}: {
  label: string;
  route: RouteAction;
  options: RouteOption[];
  onChange: (route: RouteAction) => void;
}) {
  return (
    <>
      <select
        className={styles.inputSmall}
        aria-label={`Where ${label} routes`}
        value={routeKey(route)}
        onChange={(event) => onChange(routeFromKey(event.target.value, route))}
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      {"team" in route ? (
        <select
          className={styles.inputSmall}
          aria-label={`How ${label} picks a rep in the team`}
          value={route.strategy}
          onChange={(event) =>
            onChange({ ...route, strategy: event.target.value as typeof route.strategy })
          }
        >
          {Object.entries(STRATEGY_LABELS).map(([strategy, words]) => (
            <option key={strategy} value={strategy}>
              {words}
            </option>
          ))}
        </select>
      ) : null}
      {"action" in route && route.action === "self_serve_link" && route.message ? (
        <span className={styles.muted}>with its own message</span>
      ) : null}
    </>
  );
}
