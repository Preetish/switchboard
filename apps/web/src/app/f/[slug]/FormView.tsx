"use client";

import { useRef, useState, type FormEvent } from "react";
import type { FormField } from "@switchboard/core";
import type { DecisionOutcome } from "@switchboard/db";
import styles from "./FormView.module.css";

type Values = Record<string, string | boolean>;

const CONFIRMATIONS: Record<DecisionOutcome["kind"], string> = {
  route_user:
    "Thanks — your request was routed to the right specialist. They will reach out shortly.",
  route_team:
    "Thanks — your request was routed to the right team. They will reach out shortly.",
  self_serve_link:
    "Thanks — we will email you a link so you can pick a time that suits you.",
  fallback_queue:
    "Thanks — your request is in our queue. We will get back to you shortly.",
};

export default function FormView({
  slug,
  orgName,
  formName,
  fields,
}: {
  slug: string;
  orgName: string;
  formName: string;
  fields: FormField[];
}) {
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    submissionId: string | null;
    decision: DecisionOutcome | null;
    repName: string | null;
  } | null>(null);
  // Stable per page load, so retries reuse the same key (idempotent submits).
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    try {
      const response = await fetch(`/api/f/${encodeURIComponent(slug)}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: values, idempotencyKey: idempotencyKey.current }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setErrors(body?.errors ?? { _form: "Something went wrong. Please try again." });
        return;
      }
      setResult({
        submissionId: body.submissionId ?? null,
        decision: body.decision ?? null,
        repName: typeof body.repName === "string" ? body.repName : null,
      });
    } catch {
      setErrors({ _form: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <section className={styles.card}>
        <h1 className={styles.cardTitle}>Request received</h1>
        <p className={styles.cardBody}>
          {result.repName
            ? `Thanks — your request was routed to ${result.repName}, who will reach out shortly.`
            : result.decision
              ? CONFIRMATIONS[result.decision.kind]
              : "Thanks — we received your request."}
        </p>
        {result.submissionId ? (
          <p className={styles.reference}>
            Reference: <code>{result.submissionId.slice(0, 8)}</code>
          </p>
        ) : null}
        <DeleteSection slug={slug} />
      </section>
    );
  }

  const formErrors = Object.entries(errors).filter(([key]) => key.startsWith("_form"));

  return (
    <section className={styles.card}>
      <p className={styles.org}>{orgName}</p>
      <h1 className={styles.title}>{formName}</h1>
      {formErrors.length > 0 ? (
        <div role="alert" className={styles.alert}>
          {formErrors.map(([, message]) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}
      <form onSubmit={onSubmit} noValidate>
        {fields.map((field) => (
          <div className={styles.field} key={field.key}>
            {field.type === "consent" ? (
              <label className={styles.consent}>
                <input
                  type="checkbox"
                  checked={values[field.key] === true}
                  onChange={(e) =>
                    setValues({ ...values, [field.key]: e.target.checked })
                  }
                />
                <span>{field.label}</span>
              </label>
            ) : (
              <>
                <label className={styles.label} htmlFor={field.key}>
                  {field.label}
                  {field.required ? <span aria-hidden="true"> *</span> : null}
                </label>
                {field.type === "select" ? (
                  <select
                    id={field.key}
                    className={styles.input}
                    value={(values[field.key] as string) ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [field.key]: e.target.value })
                    }
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={
                      errors[field.key]
                        ? `${field.key}-error`
                        : field.helpText
                          ? `${field.key}-help`
                          : undefined
                    }
                  >
                    <option value="">Choose one…</option>
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea
                    id={field.key}
                    className={styles.input}
                    rows={3}
                    value={(values[field.key] as string) ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [field.key]: e.target.value })
                    }
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={
                      errors[field.key]
                        ? `${field.key}-error`
                        : field.helpText
                          ? `${field.key}-help`
                          : undefined
                    }
                  />
                ) : (
                  <input
                    id={field.key}
                    className={styles.input}
                    type={
                      field.type === "number"
                        ? "number"
                        : field.type === "email"
                          ? "email"
                          : "text"
                    }
                    value={(values[field.key] as string) ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [field.key]: e.target.value })
                    }
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={
                      errors[field.key]
                        ? `${field.key}-error`
                        : field.helpText
                          ? `${field.key}-help`
                          : undefined
                    }
                  />
                )}
              </>
            )}
            {field.type === "consent" && errors[field.key] ? (
              <p className={styles.error} id={`${field.key}-error`}>
                {errors[field.key]}
              </p>
            ) : null}
            {field.type !== "consent" && field.helpText ? (
              <p className={styles.help} id={`${field.key}-help`}>
                {field.helpText}
              </p>
            ) : null}
            {field.type !== "consent" && errors[field.key] ? (
              <p className={styles.error} id={`${field.key}-error`}>
                {errors[field.key]}
              </p>
            ) : null}
          </div>
        ))}
        <button type="submit" className={styles.button} disabled={submitting}>
          {submitting ? "Sending…" : "Submit request"}
        </button>
      </form>
      <DeleteSection slug={slug} />
    </section>
  );
}

function DeleteSection({ slug }: { slug: string }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function onDelete() {
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/f/${encodeURIComponent(slug)}/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error ?? "Something went wrong. Please try again.");
      } else {
        setMessage(
          body.deleted > 0
            ? `Deleted ${body.deleted} submission${body.deleted === 1 ? "" : "s"}.`
            : "No submissions found for that email.",
        );
      }
    } catch {
      setMessage("Network error. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <details className={styles.delete}>
      <summary>Delete your data</summary>
      <p className={styles.help}>
        Enter the email you submitted and we will erase it from this form&apos;s records.
      </p>
      <div className={styles.deleteRow}>
        <input
          type="email"
          className={styles.input}
          aria-label="Email to delete"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="button"
          className={styles.deleteButton}
          onClick={onDelete}
          disabled={working || email.trim() === ""}
        >
          {working ? "Deleting…" : "Delete"}
        </button>
      </div>
      {message ? <p className={styles.help}>{message}</p> : null}
    </details>
  );
}
