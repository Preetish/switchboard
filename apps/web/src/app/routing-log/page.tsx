import { isEmailAddress } from "@switchboard/core";
import type { DecisionOutcome } from "@switchboard/db";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { adminSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { fetchDecisionLog, outcomeLabel, sourceLabel } from "@/lib/decisions-log";
import { eraseOrgSubmissions } from "@/lib/erasure";
import { findOrg } from "@/lib/integrations";
import AdminHeader from "../AdminHeader";
import admin from "../admin.module.css";
import styles from "./RoutingLog.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Routing log · Switchboard" };

const BADGE: Record<DecisionOutcome["kind"], string> = {
  route_user: styles.badgeRouted!,
  route_team: styles.badgeRouted!,
  self_serve_link: styles.badgeSelfServe!,
  fallback_queue: styles.badgeFallback!,
};

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")}Z`;
}

export default async function RoutingLogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; erased?: string }>;
}) {
  if (!(await adminSession())) redirect("/login");
  const { q, erased } = await searchParams;

  const db = getDb();
  const org = await findOrg(db);
  const entries = org ? await fetchDecisionLog(db, org.id, { q }) : [];

  async function erase(formData: FormData) {
    "use server";
    if (!(await adminSession())) redirect("/login");
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const db = getDb();
    const org = await findOrg(db);
    if (!org || !isEmailAddress(email)) redirect("/routing-log?erased=invalid");
    const count = await eraseOrgSubmissions(db, org.id, email);
    revalidatePath("/routing-log");
    redirect(`/routing-log?erased=${count}`);
  }

  const erasedCount = erased !== undefined && /^\d+$/.test(erased) ? Number(erased) : null;

  return (
    <>
      <AdminHeader active="routing-log" />
      <main className={admin.page}>
        <div className={admin.containerWide}>
          <h1 className={admin.title}>Routing log</h1>
          <p className={admin.subtitle}>
            Every routing decision: what the lead submitted, where they came from, which
            rule matched, where they went, and how long it took.
          </p>

          {erased === "invalid" ? (
            <p className={admin.bannerError} role="status">
              Enter a valid email address to erase.
            </p>
          ) : erasedCount !== null ? (
            <p className={admin.bannerOk} role="status">
              {erasedCount === 0
                ? "No submissions found for that address. Nothing was erased."
                : `Erased ${erasedCount} submission${erasedCount === 1 ? "" : "s"} with their decisions and bookings.`}
            </p>
          ) : null}

          <div className={styles.toolbar}>
            <form action="/routing-log" method="get" className={styles.search}>
              <input
                type="search"
                name="q"
                defaultValue={q ?? ""}
                placeholder="Search by email, rule, reason, or campaign"
                aria-label="Search the routing log"
                className={admin.input}
              />
              <button type="submit" className={admin.buttonSecondary}>
                Search
              </button>
            </form>
            <form action="/api/decisions/export" method="get">
              {q ? <input type="hidden" name="q" value={q} /> : null}
              <button type="submit" className={admin.buttonSecondary}>
                Download CSV
              </button>
            </form>
          </div>

          <p className={styles.count}>
            {entries.length} decision{entries.length === 1 ? "" : "s"}, newest first
            {q ? ` matching "${q}"` : ""}.
          </p>

          {entries.length === 0 ? (
            <p className={styles.empty}>
              {q ? (
                `No decisions match "${q}".`
              ) : (
                <>
                  No routing decisions yet. Submit one of your forms (try{" "}
                  <Link href="/f/book-a-demo">the demo form</Link>) and it shows up here.
                </>
              )}
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Decided (UTC)</th>
                    <th scope="col">Lead</th>
                    <th scope="col">Source</th>
                    <th scope="col">Rule</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Rep / team</th>
                    <th scope="col">Latency</th>
                    <th scope="col">
                      <span className={styles.visuallyHidden}>Inputs</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className={styles.mono}>{formatUtc(entry.createdAt)}</td>
                      <td>{entry.leadEmail ?? <span className={styles.muted}>(no email)</span>}</td>
                      <td>
                        {sourceLabel(entry.attribution) ?? (
                          <span className={styles.muted}>Direct</span>
                        )}
                      </td>
                      <td>{entry.matchedRule ?? <span className={styles.muted}>Fallback</span>}</td>
                      <td>
                        <span className={BADGE[entry.outcome.kind]}>
                          {outcomeLabel(entry.outcome.kind)}
                        </span>
                        <div className={styles.reason}>{entry.outcome.reason}</div>
                      </td>
                      <td>
                        {entry.repName ?? entry.teamName ?? (
                          <span className={styles.muted}>None</span>
                        )}
                      </td>
                      <td className={styles.mono}>{entry.latencyMs} ms</td>
                      <td>
                        <details className={styles.inputs}>
                          <summary>Inputs</summary>
                          <pre>{JSON.stringify(entry.inputs, null, 2)}</pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <section className={admin.section} aria-labelledby="erase">
            <h2 id="erase" className={admin.sectionTitle}>
              Erase a lead&apos;s data
            </h2>
            <p className={admin.sectionBody}>
              For deletion requests that reach you directly. Removes every submission from
              this address across all forms, with its routing decisions and bookings.
              Calendar events and CRM records are kept in those systems.
            </p>
            <form action={erase} className={styles.search}>
              <input
                type="email"
                name="email"
                required
                placeholder="lead@company.com"
                aria-label="Lead email to erase"
                className={admin.input}
              />
              <button type="submit" className={admin.buttonSecondary}>
                Erase
              </button>
            </form>
          </section>
        </div>
      </main>
    </>
  );
}
