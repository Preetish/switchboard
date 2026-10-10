"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { groupSlotsByDay, type FormField, type SlotGroup } from "@switchboard/core";
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

/** Meeting length offered for instant booking, in minutes. */
const MEETING_MINUTES = 30;
/** How far ahead the inline calendar looks, in days. */
const AVAILABILITY_DAYS = 14;

type Availability = {
  rep: { name: string; timeZone: string };
  source: "google" | "local";
  calendarError?: string;
  slots: { start: string; end: string }[];
};

type BookedResult = {
  duplicate: boolean;
  booking: {
    id: string;
    startAt: string;
    endAt: string;
    meetLink: string | null;
  };
  calendarError?: string;
  emailSent: boolean;
};

export default function FormView({
  slug,
  orgName,
  formName,
  fields,
  embedded = false,
}: {
  slug: string;
  orgName: string;
  formName: string;
  fields: FormField[];
  embedded?: boolean;
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

  // Embed mode (packages/embed): make the iframe blend into the host page and
  // report the content height so the host can resize with no scrollbars. The
  // host loader validates the message's origin and source; the payload is
  // only a height number.
  useEffect(() => {
    if (!embedded) return;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    const inIframe = window.parent !== window;
    let target: string = "*";
    try {
      target = new URL(document.referrer).origin;
    } catch {
      // Referrer blocked (e.g. a strict referrer policy); the loader still
      // validates origin and source, and the payload is a height number.
    }
    const post = () => {
      if (!inIframe) return;
      // The body's own height, not documentElement.scrollHeight: inside an
      // iframe scrollHeight is floored by the viewport, so the iframe could
      // grow but never shrink back.
      window.parent.postMessage(
        { type: "switchboard:resize", height: document.body.getBoundingClientRect().height },
        target,
      );
    };
    post();
    const observer = new ResizeObserver(post);
    observer.observe(document.body);
    return () => {
      observer.disconnect();
      document.body.style.background = "";
      document.documentElement.style.background = "";
    };
  }, [embedded]);

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
    const repId = result.decision?.userId;
    if (repId) {
      return (
        <section className={styles.card}>
          <BookingPanel
            slug={slug}
            repId={repId}
            routedName={result.repName}
            submissionId={result.submissionId}
          />
        </section>
      );
    }
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

function leadTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function formatDayLabel(dateKey: string): string {
  // Noon local time: the calendar date never tips over a day boundary.
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateKey}T12:00:00`));
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * The instant-booking flow: the lead just submitted, routing picked a rep,
 * and their calendar renders inline so the meeting is booked before the
 * lead leaves the page. Availability and booking come from the same API
 * surface the embed uses (tasks 5 and 7).
 */
function BookingPanel({
  slug,
  repId,
  routedName,
  submissionId,
}: {
  slug: string;
  repId: string;
  routedName: string | null;
  submissionId: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [days, setDays] = useState<SlotGroup[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [booked, setBooked] = useState<BookedResult | null>(null);
  // Bumped to (re)load availability; doubles as the retry mechanism.
  const [reloadToken, setReloadToken] = useState(0);
  // Stable per page load: a retried confirm returns the original booking.
  const bookingKey = useRef<string>(crypto.randomUUID());

  const repName = routedName ?? availability?.rep.name ?? "the rep";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      setSelectedSlot(null);
      setBookingError(null);
      try {
        const response = await fetch(
          `/api/availability/${encodeURIComponent(repId)}?duration=${MEETING_MINUTES}&days=${AVAILABILITY_DAYS}`,
        );
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setLoadError(body?.error ?? "Could not load the calendar. Please try again.");
          return;
        }
        const data = body as Availability;
        const grouped = groupSlotsByDay(data.slots, leadTimeZone());
        setAvailability(data);
        setDays(grouped);
        setSelectedDay(grouped[0]?.dateKey ?? null);
      } catch {
        if (!cancelled) setLoadError("Network error. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [repId, reloadToken]);

  async function confirmBooking() {
    if (!selectedSlot) return;
    setBooking(true);
    setBookingError(null);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: repId,
          startAt: selectedSlot,
          durationMinutes: MEETING_MINUTES,
          submissionId,
          idempotencyKey: bookingKey.current,
        }),
      });
      const body = await response.json().catch(() => null);
      // 201 always carries the booking row; anything else is a failure shape.
      if (response.ok && body?.booking) {
        setBooked(body as BookedResult);
        return;
      }
      setBookingError(body?.error ?? "Something went wrong. Please try again.");
      // A taken or stale slot changes what is bookable; refresh the calendar.
      if (response.status === 409) setReloadToken((token) => token + 1);
    } catch {
      setBookingError("Network error. Please try again.");
    } finally {
      setBooking(false);
    }
  }

  if (booked) {
    const start = new Date(booked.booking.startAt);
    const range = `${formatTime(booked.booking.startAt)} – ${formatTime(booked.booking.endAt)}`;
    const day = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(start);
    return (
      <>
        <h1 className={styles.cardTitle}>Meeting booked</h1>
        <p className={styles.cardBody}>
          {day} at {range} ({leadTimeZone()}) with {repName}.
        </p>
        {booked.booking.meetLink ? (
          <p className={styles.meetLink}>
            <a href={booked.booking.meetLink}>Join the video call</a>
          </p>
        ) : booked.calendarError ? (
          <p className={styles.help}>
            The calendar event could not be created — we will email you a booking
            link instead.
          </p>
        ) : null}
        {booked.emailSent ? (
          <p className={styles.help}>A confirmation email is on its way.</p>
        ) : null}
        <p className={styles.reference}>
          Reference: <code>{booked.booking.id.slice(0, 8)}</code>
        </p>
        <DeleteSection slug={slug} />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <h1 className={styles.cardTitle}>Request received</h1>
        <p className={styles.cardBody}>
          Thanks — your request was routed to {repName}. Loading their calendar…
        </p>
        <p role="status" className={styles.help}>
          Finding open times…
        </p>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <h1 className={styles.cardTitle}>Request received</h1>
        <p className={styles.cardBody}>
          Thanks — your request was routed to {repName}, who will reach out
          shortly.
        </p>
        <div role="alert" className={styles.alert}>
          <p>{loadError}</p>
        </div>
        <button
          type="button"
          className={styles.button}
          onClick={() => setReloadToken((token) => token + 1)}
        >
          Try loading times again
        </button>
        <DeleteSection slug={slug} />
      </>
    );
  }

  const activeDay = days.find((group) => group.dateKey === selectedDay) ?? days[0];
  const zone = leadTimeZone();

  return (
    <>
      <h1 className={styles.cardTitle}>Pick a time with {repName}</h1>
      <p className={styles.cardBody}>
        Your request was routed to {repName}
        {availability?.rep.timeZone && availability.rep.timeZone !== zone
          ? ` (in ${availability.rep.timeZone})`
          : ""}
        . Book a meeting right here — no email tag needed.
      </p>
      {availability?.calendarError ? (
        <p className={styles.help}>
          Live calendar is unavailable right now — times reflect local bookings
          only.
        </p>
      ) : null}
      {bookingError ? (
        <div role="alert" className={styles.alert}>
          <p>{bookingError}</p>
        </div>
      ) : null}
      {days.length === 0 ? (
        <p role="status" className={styles.cardBody}>
          {repName} has no open times in the next {AVAILABILITY_DAYS} days —
          they will follow up by email.
        </p>
      ) : (
        <>
          <div className={styles.dayTabs} role="group" aria-label="Choose a day">
            {days.map((group) => (
              <button
                key={group.dateKey}
                type="button"
                className={`${styles.dayTab} ${group.dateKey === activeDay?.dateKey ? styles.dayTabActive : ""}`}
                aria-pressed={group.dateKey === activeDay?.dateKey}
                onClick={() => {
                  setSelectedDay(group.dateKey);
                  setSelectedSlot(null);
                }}
              >
                {formatDayLabel(group.dateKey)}
              </button>
            ))}
          </div>
          <div className={styles.slotGrid} role="group" aria-label="Choose a time">
            {activeDay?.slots.map((slot) => (
              <button
                key={slot.start}
                type="button"
                className={`${styles.slot} ${slot.start === selectedSlot ? styles.slotActive : ""}`}
                aria-pressed={slot.start === selectedSlot}
                onClick={() => setSelectedSlot(slot.start)}
              >
                {formatTime(slot.start)}
              </button>
            ))}
          </div>
          <p className={styles.help}>Times in your time zone ({zone}).</p>
          {selectedSlot ? (
            <div className={styles.confirmBar}>
              <span>
                {formatDayLabel(selectedDay ?? "")} · {formatTime(selectedSlot)} –{" "}
                {formatTime(
                  new Date(
                    new Date(selectedSlot).getTime() + MEETING_MINUTES * 60_000,
                  ).toISOString(),
                )}
              </span>
              <button
                type="button"
                className={styles.button}
                onClick={() => void confirmBooking()}
                disabled={booking}
              >
                {booking ? "Booking…" : "Confirm booking"}
              </button>
            </div>
          ) : null}
        </>
      )}
      <DeleteSection slug={slug} />
    </>
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
