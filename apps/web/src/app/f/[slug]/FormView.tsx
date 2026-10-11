"use client";

import Script from "next/script";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  groupSlotsByDay,
  touchFromUrl,
  type Attribution,
  type FormField,
  type SlotGroup,
} from "@switchboard/core/client";
import type { DecisionOutcome, FormSettings } from "@switchboard/db";
import styles from "./FormView.module.css";

type Values = Record<string, string | boolean>;

/** Meeting length offered for instant booking, in minutes. */
const MEETING_MINUTES = 30;
/** How far ahead the inline calendar looks, in days. */
const AVAILABILITY_DAYS = 14;

type Availability = {
  rep: { name: string; timeZone: string };
  /** The live calendar couldn't be read; times reflect local bookings only. */
  degraded: boolean;
  slots: { start: string; end: string }[];
};

type BookedResult = {
  duplicate: boolean;
  booking: { id: string; startAt: string; endAt: string; meetLink: string | null };
  calendarFailed: boolean;
  emailQueued: boolean;
  invited: boolean;
};

type PublicDecision = { kind: DecisionOutcome["kind"]; userId: string | null };

type Result = {
  submissionId: string | null;
  decision: PublicDecision | null;
  repName: string | null;
  email: string | null;
};

export default function FormView({
  slug,
  orgName,
  formName,
  fields,
  settings,
  embedded = false,
  preview = false,
  turnstileSiteKey = null,
}: {
  slug: string;
  orgName: string;
  formName: string;
  fields: FormField[];
  settings: FormSettings;
  embedded?: boolean;
  /** Admin preview: shows the form as leads see it, but can't submit. */
  preview?: boolean;
  /** Cloudflare Turnstile site key when the optional bot check is on. */
  turnstileSiteKey?: string | null;
}) {
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  // The form only works once React is running; until then the button stays
  // disabled so an early click can't fall through to a native form submit.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // Stable per page load, so retries reuse the same key (idempotent submits).
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const { attribution, notifyHost } = useEmbed(embedded);

  const emailKey = fields.find((field) => field.type === "email")?.key;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) return;
    setSubmitting(true);
    setErrors({});
    try {
      const formData = new FormData(event.currentTarget);
      const honeypot = formData.get("sb_website");
      const captchaToken = formData.get("cf-turnstile-response");
      const response = await fetch(`/api/f/${encodeURIComponent(slug)}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: values,
          honeypot: typeof honeypot === "string" ? honeypot : "",
          captchaToken: typeof captchaToken === "string" ? captchaToken : undefined,
          idempotencyKey: idempotencyKey.current,
          attribution,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setErrors(
          body?.errors ?? {
            _form: "We couldn't send the form. Check your connection and try again.",
          },
        );
        return;
      }
      notifyHost("submitted", body.decision?.kind);
      setResult({
        submissionId: body.submissionId ?? null,
        decision: body.decision ?? null,
        repName: typeof body.repName === "string" ? body.repName : null,
        email:
          emailKey && typeof values[emailKey] === "string" ? (values[emailKey] as string) : null,
      });
    } catch {
      setErrors({ _form: "We couldn't reach the server. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <section className={`${styles.card} sb-card`}>
        <Outcome
          result={result}
          orgName={orgName}
          settings={settings}
          onBooked={() => notifyHost("booked", result.decision?.kind)}
        />
        <PrivacyFooter slug={slug} />
      </section>
    );
  }

  const formErrors = Object.entries(errors).filter(([key]) => key.startsWith("_form"));
  const describedBy = (field: FormField) =>
    errors[field.key] ? `${field.key}-error` : field.helpText ? `${field.key}-help` : undefined;
  const setValue = (key: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <section className={`${styles.card} sb-card`}>
      {preview ? (
        <p className={styles.previewNote}>Preview: submitting is turned off here.</p>
      ) : null}
      <p className={`${styles.org} sb-org`}>{orgName}</p>
      <h1 className={`${styles.title} sb-title`}>{formName}</h1>
      {formErrors.length > 0 ? (
        <div role="alert" className={`${styles.alert} sb-alert`}>
          {formErrors.map(([, message]) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}
      <form onSubmit={onSubmit} method="post" noValidate>
        <div className={styles.honeypot} aria-hidden="true">
          <label htmlFor="sb_website">Leave this field empty</label>
          <input
            id="sb_website"
            name="sb_website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </div>
        {fields.map((field) => (
          <div className={`${styles.field} sb-field`} key={field.key}>
            {field.type === "consent" ? (
              <label className={styles.consent}>
                <input
                  type="checkbox"
                  checked={values[field.key] === true}
                  onChange={(e) => setValue(field.key, e.target.checked)}
                  aria-invalid={Boolean(errors[field.key])}
                  aria-describedby={describedBy(field)}
                />
                <span>{field.label}</span>
              </label>
            ) : (
              <>
                <label className={`${styles.label} sb-label`} htmlFor={field.key}>
                  {field.label}
                  {field.required ? null : <span className={styles.optional}> (optional)</span>}
                </label>
                {field.type === "select" ? (
                  <select
                    id={field.key}
                    className={`${styles.input} sb-input`}
                    value={(values[field.key] as string) ?? ""}
                    onChange={(e) => setValue(field.key, e.target.value)}
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={describedBy(field)}
                    required={field.required}
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
                    className={`${styles.input} sb-input`}
                    rows={3}
                    value={(values[field.key] as string) ?? ""}
                    onChange={(e) => setValue(field.key, e.target.value)}
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={describedBy(field)}
                  />
                ) : (
                  <input
                    id={field.key}
                    className={`${styles.input} sb-input`}
                    type={field.type === "email" ? "email" : "text"}
                    inputMode={field.type === "number" ? "numeric" : undefined}
                    autoComplete={autocompleteFor(field)}
                    value={(values[field.key] as string) ?? ""}
                    onChange={(e) => setValue(field.key, e.target.value)}
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={describedBy(field)}
                    required={field.required}
                  />
                )}
              </>
            )}
            {field.type !== "consent" && field.helpText ? (
              <p className={`${styles.help} sb-help`} id={`${field.key}-help`}>
                {field.helpText}
              </p>
            ) : null}
            {errors[field.key] ? (
              <p className={`${styles.error} sb-error`} id={`${field.key}-error`}>
                {errors[field.key]}
              </p>
            ) : null}
          </div>
        ))}
        {turnstileSiteKey ? (
          <>
            <Script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js"
              strategy="afterInteractive"
            />
            <div className={`cf-turnstile ${styles.captcha}`} data-sitekey={turnstileSiteKey} />
          </>
        ) : null}
        <button type="submit" className={`${styles.button} sb-button`} disabled={!ready || submitting}>
          {submitting ? "Sending…" : (settings.submitLabel ?? "Continue")}
        </button>
      </form>
      <PrivacyFooter slug={slug} />
    </section>
  );
}

/** Browser autofill hints for the common lead fields. */
function autocompleteFor(field: FormField): string | undefined {
  if (field.type === "email") return "email";
  if (field.key === "name" || field.key === "full_name") return "name";
  if (field.key === "company" || field.key === "company_name") return "organization";
  if (field.key === "phone") return "tel";
  return undefined;
}

/** What the lead sees after submitting, by routing outcome. */
function Outcome({
  result,
  orgName,
  settings,
  onBooked,
}: {
  result: Result;
  orgName: string;
  settings: FormSettings;
  onBooked: () => void;
}) {
  const repId = result.decision?.userId;
  if (repId && result.submissionId) {
    return (
      <BookingPanel
        repId={repId}
        routedName={result.repName}
        submissionId={result.submissionId}
        orgName={orgName}
        onBooked={onBooked}
      />
    );
  }
  if (result.decision?.kind === "self_serve_link" && settings.selfServeUrl) {
    return (
      <>
        <h1 className={`${styles.cardTitle} sb-heading`}>You can get started right away</h1>
        <p className={`${styles.cardBody} sb-text`}>
          Thanks for reaching out. You can set things up yourself on the next page, without
          waiting for a call.
        </p>
        <a className={`${styles.linkButton} sb-button`} href={settings.selfServeUrl} target="_top">
          Get started
        </a>
      </>
    );
  }
  const who = result.repName ?? `Someone from ${orgName}`;
  return (
    <>
      <h1 className={`${styles.cardTitle} sb-heading`}>Thanks, we have your request</h1>
      <p className={`${styles.cardBody} sb-text`}>
        {who} will be in touch
        {result.email ? (
          <>
            {" "}
            at <strong>{result.email}</strong>
          </>
        ) : null}{" "}
        soon.
      </p>
    </>
  );
}

function leadTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** "Eastern Time" for America/New_York; falls back to the zone id. */
function friendlyZone(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      timeZoneName: "longGeneric",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? zone;
  } catch {
    return zone;
  }
}

function formatDayLabel(dateKey: string): { weekday: string; date: string } {
  // Noon local time: the calendar date never tips over a day boundary.
  const date = new Date(`${dateKey}T12:00:00`);
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
    date: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date),
  };
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );
}

function formatLongDay(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

/**
 * Instant booking: routing picked a rep, and their open times render right
 * here so the lead books before leaving the page.
 */
function BookingPanel({
  repId,
  routedName,
  submissionId,
  orgName,
  onBooked,
}: {
  repId: string;
  routedName: string | null;
  submissionId: string;
  orgName: string;
  onBooked: () => void;
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

  const repName = routedName ?? availability?.rep.name ?? `your contact at ${orgName}`;
  const zone = leadTimeZone();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      setSelectedSlot(null);
      try {
        const query = new URLSearchParams({
          submission: submissionId,
          duration: String(MEETING_MINUTES),
          days: String(AVAILABILITY_DAYS),
        });
        const response = await fetch(
          `/api/availability/${encodeURIComponent(repId)}?${query.toString()}`,
        );
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setLoadError(body?.error ?? "We couldn't load the calendar.");
          return;
        }
        const data = body as Availability;
        const grouped = groupSlotsByDay(data.slots, leadTimeZone());
        setAvailability(data);
        setDays(grouped);
        setSelectedDay((current) =>
          grouped.some((group) => group.dateKey === current)
            ? current
            : (grouped[0]?.dateKey ?? null),
        );
      } catch {
        if (!cancelled) setLoadError("We couldn't reach the server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [repId, submissionId, reloadToken]);

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
      if (response.ok && body?.booking) {
        setBooked(body as BookedResult);
        if (!body.duplicate) onBooked();
        return;
      }
      setBookingError(body?.error ?? "We couldn't book that time. Please try again.");
      // A taken or stale slot changes what is bookable; refresh the calendar.
      if (response.status === 409) setReloadToken((token) => token + 1);
    } catch {
      setBookingError("We couldn't reach the server. Please try again.");
    } finally {
      setBooking(false);
    }
  }

  if (booked) {
    const { booking: b } = booked;
    return (
      <>
        <p className={styles.eyebrow}>
          <span className={styles.check} aria-hidden="true">
            ✓
          </span>
          Booked
        </p>
        <h1 className={`${styles.cardTitle} sb-heading`}>You&apos;re meeting {repName}</h1>
        <div className={`${styles.summary} sb-summary`}>
          <p className={styles.summaryWhen}>{formatLongDay(b.startAt)}</p>
          <p>
            {formatTime(b.startAt)} to {formatTime(b.endAt)}, {friendlyZone(zone)}
          </p>
        </div>
        {b.meetLink ? (
          <a className={`${styles.linkButton} sb-button`} href={b.meetLink} target="_blank" rel="noreferrer">
            Join with Google Meet
          </a>
        ) : null}
        <p className={`${styles.cardBody} sb-text`}>
          {booked.invited
            ? "A calendar invite is on its way to your inbox."
            : `${repName} will send you a calendar invite.`}
          {booked.emailQueued ? " We've also emailed you the details." : null}
        </p>
      </>
    );
  }

  const activeDay = days.find((group) => group.dateKey === selectedDay) ?? days[0];

  return (
    <>
      <h1 className={`${styles.cardTitle} sb-heading`}>Pick a time with {repName}</h1>
      <p className={`${styles.cardBody} sb-text`}>
        Choose a time for a {MEETING_MINUTES}‑minute call. {repName} handles requests like
        yours.
      </p>

      {loading ? (
        <div className={styles.skeleton} role="status" aria-label="Loading open times">
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonGrid}>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={styles.skeletonCell} />
            ))}
          </div>
        </div>
      ) : loadError ? (
        <div role="alert" className={`${styles.alert} sb-alert`}>
          <p>{loadError}</p>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => setReloadToken((token) => token + 1)}
          >
            Try again
          </button>
        </div>
      ) : days.length === 0 ? (
        <p role="status" className={`${styles.notice} sb-notice`}>
          {repName} has no open times in the next {AVAILABILITY_DAYS} days, so they&apos;ll
          reach out to find one that works.
        </p>
      ) : (
        <>
          {availability?.degraded ? (
            <p className={`${styles.notice} sb-notice`}>
              We couldn&apos;t reach {repName}&apos;s calendar. If the time you pick clashes with
              something, they&apos;ll suggest another.
            </p>
          ) : null}
          {bookingError ? (
            <div role="alert" className={`${styles.alert} sb-alert`}>
              <p>{bookingError}</p>
            </div>
          ) : null}
          <div className={styles.dayTabs} role="group" aria-label="Choose a day">
            {days.map((group) => {
              const label = formatDayLabel(group.dateKey);
              const active = group.dateKey === activeDay?.dateKey;
              return (
                <button
                  key={group.dateKey}
                  type="button"
                  className={`${active ? styles.dayTabActive : styles.dayTab} sb-day${active ? " sb-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedDay(group.dateKey);
                    setSelectedSlot(null);
                  }}
                >
                  <span className={styles.dayTabWeekday}>{label.weekday}</span>
                  <span>{label.date}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.slotGrid} role="group" aria-label="Choose a time">
            {activeDay?.slots.map((slot) => {
              const active = slot.start === selectedSlot;
              return (
                <button
                  key={slot.start}
                  type="button"
                  className={`${active ? styles.slotActive : styles.slot} sb-slot${active ? " sb-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => setSelectedSlot(slot.start)}
                >
                  {formatTime(slot.start)}
                </button>
              );
            })}
          </div>
          <p className={`${styles.help} sb-help`}>Times are in {friendlyZone(zone)}.</p>
          <button
            type="button"
            className={`${styles.button} sb-button`}
            onClick={() => void confirmBooking()}
            disabled={!selectedSlot || booking}
          >
            {booking
              ? "Booking…"
              : selectedSlot && activeDay
                ? `Book ${formatDayLabel(activeDay.dateKey).weekday} at ${formatTime(selectedSlot)}`
                : "Choose a time"}
          </button>
        </>
      )}
    </>
  );
}

/** A quiet link to request deletion of what the lead submitted. */
function PrivacyFooter({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function onRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/f/${encodeURIComponent(slug)}/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => null);
      setMessage(
        response.ok
          ? (body?.message ?? "Check your inbox for a confirmation link.")
          : (body?.error ?? "Something went wrong. Please try again."),
      );
    } catch {
      setMessage("We couldn't reach the server. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={`${styles.privacy} sb-privacy`}>
      {open ? (
        <form onSubmit={onRequest}>
          <label htmlFor={`${slug}-delete-email`} className={`${styles.help} sb-help`}>
            Enter the email you used. We&apos;ll send a link to confirm deleting your data.
          </label>
          <div className={styles.deleteRow}>
            <input
              id={`${slug}-delete-email`}
              type="email"
              className={`${styles.input} sb-input`}
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" className={styles.deleteButton} disabled={working}>
              {working ? "Sending…" : "Send link"}
            </button>
          </div>
          {message ? (
            <p className={`${styles.help} sb-help`} role="status">
              {message}
            </p>
          ) : null}
        </form>
      ) : (
        <button type="button" className={styles.textButton} onClick={() => setOpen(true)}>
          Delete my data
        </button>
      )}
    </div>
  );
}

/**
 * Embed mode (packages/embed) and attribution.
 *
 * - Makes the iframe blend into the host page and reports the content height
 *   so the host can resize it with no scrollbars.
 * - Attribution starts from this page's own URL and referrer (direct links
 *   to /f/<slug>?utm_source=…). Inside the embed it asks the loader on the
 *   host page, which knows the visitor's real landing URL, first touch, and
 *   (with consent) cookie IDs. The server sanitizes whatever arrives.
 * - `notifyHost` tells the loader about conversions so the host page's own
 *   analytics tags can fire. Payloads never carry personal data.
 */
function useEmbed(embedded: boolean): {
  attribution: Attribution | null;
  notifyHost: (name: "submitted" | "booked", outcome: string | undefined) => void;
} {
  const [attribution, setAttribution] = useState<Attribution | null>(null);
  const target = useRef("*");

  useEffect(() => {
    const own = touchFromUrl(window.location.href, document.referrer);
    // In the embed, document.referrer is the host page itself, not a touch;
    // the loader supplies the real one below.
    if (own && !(embedded && !hasCampaignParams(window.location.href))) {
      setAttribution({ ...own, page_url: own.landing_page });
    }
    if (!embedded) return;

    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    const inIframe = window.parent !== window;
    try {
      target.current = new URL(document.referrer).origin;
    } catch {
      // Referrer blocked (strict referrer policy); the loader still
      // validates origin and source, and payloads carry no personal data.
    }
    const post = (message: Record<string, unknown>) => {
      if (inIframe) window.parent.postMessage(message, target.current);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as { type?: unknown; attribution?: unknown } | null;
      if (data?.type === "switchboard:attribution" && data.attribution && typeof data.attribution === "object") {
        setAttribution(data.attribution as Attribution);
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "switchboard:ready" });

    // The body's own height, not documentElement.scrollHeight: inside an
    // iframe scrollHeight is floored by the viewport, so the iframe could
    // grow but never shrink back.
    const resize = () =>
      post({ type: "switchboard:resize", height: document.body.getBoundingClientRect().height });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(document.body);
    return () => {
      observer.disconnect();
      window.removeEventListener("message", onMessage);
      document.body.style.background = "";
      document.documentElement.style.background = "";
    };
  }, [embedded]);

  const notifyHost = (name: "submitted" | "booked", outcome: string | undefined) => {
    if (!embedded || window.parent === window) return;
    window.parent.postMessage({ type: "switchboard:event", name, outcome }, target.current);
  };

  return { attribution, notifyHost };
}

function hasCampaignParams(href: string): boolean {
  return touchFromUrl(href, "") !== null;
}
