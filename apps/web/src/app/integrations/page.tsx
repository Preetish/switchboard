import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { integrations, users } from "@switchboard/db";
import { adminSession } from "@/lib/auth";
import { hubspotConfig } from "@/lib/crm";
import { getDb } from "@/lib/db";
import { appBaseUrl, findOrg, googleConfig } from "@/lib/integrations";
import { signConnectLink } from "@/lib/oauth-state";
import { deleteTokens } from "@/lib/token-store";
import AdminHeader from "../AdminHeader";
import styles from "../admin.module.css";
import CopyButton from "./CopyButton";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  google_not_configured:
    "Google isn't set up yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment and restart (see the self-hosting guide).",
  hubspot_not_configured:
    "HubSpot isn't set up yet. Add HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET to your environment and restart (see the self-hosting guide).",
  auth_not_configured: "Set AUTH_SECRET in your environment and restart, then try again.",
  org_missing: "No organization found. Run the migrations and load your config first.",
  rep_missing: "That rep no longer exists. Refresh the page and try again.",
  state_mismatch:
    "The connection request expired or didn't match. Nothing was connected — try again.",
  denied: "Consent was declined. Nothing was connected.",
  scope_missing:
    "Calendar access was only partly granted. Reconnect and keep both calendar permissions ticked.",
  exchange_failed:
    "The provider rejected the connection. Check the OAuth app's credentials and redirect URI, then try again.",
};

const CONNECTED: Record<string, string> = {
  google: "Calendar connected. That rep's availability now comes from their Google Calendar.",
  hubspot: "HubSpot connected. Owner routing and contact write-back are on.",
};

function formatUpdated(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const session = await adminSession();
  if (!session) redirect("/login");
  const { connected, error } = await searchParams;
  const db = getDb();
  const org = await findOrg(db);

  const reps = org
    ? await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          accountEmail: integrations.accountEmail,
          updatedAt: integrations.updatedAt,
        })
        .from(users)
        .leftJoin(
          integrations,
          and(
            eq(integrations.userId, users.id),
            eq(integrations.provider, "google_calendar"),
          ),
        )
        .where(eq(users.orgId, org.id))
        .orderBy(asc(users.name))
    : [];
  const [hubspot] = org
    ? await db
        .select({ updatedAt: integrations.updatedAt })
        .from(integrations)
        .where(
          and(
            eq(integrations.orgId, org.id),
            eq(integrations.provider, "hubspot"),
            isNull(integrations.userId),
          ),
        )
        .limit(1)
    : [];

  const banner = connected
    ? { ok: true, text: CONNECTED[connected] ?? "Connected." }
    : error
      ? {
          ok: false,
          text: ERRORS[error] ?? "Something went wrong while connecting. Nothing was changed.",
        }
      : null;
  const googleReady = googleConfig() !== null;
  const base = appBaseUrl();

  async function disconnect(formData: FormData) {
    "use server";
    if (!(await adminSession())) redirect("/login");
    const db = getDb();
    const org = await findOrg(db);
    const provider = formData.get("provider");
    if (!org) return;
    if (provider === "hubspot") {
      await deleteTokens(db, "hubspot", { orgId: org.id, userId: null });
    } else if (provider === "google_calendar") {
      const userId = String(formData.get("userId") ?? "");
      await deleteTokens(db, "google_calendar", { orgId: org.id, userId });
    }
    revalidatePath("/integrations");
  }

  return (
    <>
      <AdminHeader active="integrations" />
      <main className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.title}>Integrations</h1>
          <p className={styles.subtitle}>
            {org ? (
              <>
                Calendars and CRM for <strong>{org.name}</strong>.
              </>
            ) : (
              <>
                No organization found. Run <code className={styles.code}>npm run db:migrate</code>{" "}
                and load your config first.
              </>
            )}
          </p>

          {banner ? (
            <p className={banner.ok ? styles.bannerOk : styles.bannerError} role="status">
              {banner.text}
            </p>
          ) : null}

          <section className={styles.section} aria-labelledby="calendars">
            <h2 id="calendars" className={styles.sectionTitle}>
              Google Calendar
            </h2>
            <p className={styles.sectionBody}>
              Each rep connects their own calendar. Leads only see times when that rep
              is free, and booked meetings land on the rep&apos;s calendar with a Meet
              link. Until a rep connects, their working hours and existing bookings decide
              what&apos;s offered.
            </p>
            {!googleReady ? (
              <p className={styles.bannerError}>
                Add <code className={styles.code}>GOOGLE_CLIENT_ID</code> and{" "}
                <code className={styles.code}>GOOGLE_CLIENT_SECRET</code> to connect
                calendars. Use redirect URI{" "}
                <code className={styles.code}>{base}/api/integrations/google/callback</code>.
              </p>
            ) : null}
            {reps.length === 0 ? (
              <p className={styles.sectionBody}>No reps yet. Add them to your config.</p>
            ) : (
              <ul className={styles.list}>
                {reps.map((rep) => {
                  const link = signConnectLink(rep.id);
                  const otherAccount =
                    rep.accountEmail && rep.accountEmail !== rep.email.toLowerCase();
                  return (
                    <li key={rep.id} className={styles.row}>
                      <div className={styles.rowMain}>
                        <div className={styles.rowName}>{rep.name}</div>
                        <div className={styles.muted}>{rep.email}</div>
                        <div className={styles.status}>
                          {rep.updatedAt ? (
                            <>
                              <span className={otherAccount ? styles.dotWarn : styles.dotOk} />
                              {otherAccount
                                ? `Connected as ${rep.accountEmail} — check this is the right calendar`
                                : `Connected${rep.accountEmail ? ` as ${rep.accountEmail}` : ""}`}
                            </>
                          ) : (
                            <>
                              <span className={styles.dot} />
                              Not connected
                            </>
                          )}
                        </div>
                      </div>
                      {googleReady ? (
                        <div className={styles.rowActions}>
                          {link ? (
                            <CopyButton
                              value={`${base}/api/integrations/google/connect?${link}`}
                              label="Copy connect link"
                            />
                          ) : null}
                          <a
                            className={styles.buttonSecondary}
                            href={`/api/integrations/google/connect?userId=${rep.id}`}
                          >
                            {rep.updatedAt ? "Reconnect" : "Connect here"}
                          </a>
                          {rep.updatedAt ? (
                            <form action={disconnect}>
                              <input type="hidden" name="provider" value="google_calendar" />
                              <input type="hidden" name="userId" value={rep.id} />
                              <button type="submit" className={styles.buttonSecondary}>
                                Disconnect
                              </button>
                            </form>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {googleReady ? (
              <p className={styles.footnote}>
                Send each rep their connect link (valid for 7 days) so they can sign in with
                their own Google account. Use “Connect here” only when the rep is at this
                computer.
              </p>
            ) : null}
          </section>

          <section className={styles.section} aria-labelledby="crm">
            <h2 id="crm" className={styles.sectionTitle}>
              HubSpot
            </h2>
            <p className={styles.sectionBody}>
              Routes leads to the rep who already owns the contact, adds new leads as
              contacts, and logs booked meetings on the contact&apos;s timeline. Reps are
              matched to HubSpot owners by email.
            </p>
            <div className={styles.status}>
              {hubspot ? (
                <>
                  <span className={styles.dotOk} />
                  Connected · updated {formatUpdated(hubspot.updatedAt)}
                </>
              ) : (
                <>
                  <span className={styles.dot} />
                  Not connected
                </>
              )}
            </div>
            {hubspotConfig() ? (
              <div className={styles.actions}>
                <a className={styles.button} href="/api/integrations/hubspot/connect">
                  {hubspot ? "Reconnect HubSpot" : "Connect HubSpot"}
                </a>
                {hubspot ? (
                  <form action={disconnect}>
                    <input type="hidden" name="provider" value="hubspot" />
                    <button type="submit" className={styles.buttonSecondary}>
                      Disconnect
                    </button>
                  </form>
                ) : null}
              </div>
            ) : (
              <p className={styles.bannerError}>
                Add <code className={styles.code}>HUBSPOT_CLIENT_ID</code> and{" "}
                <code className={styles.code}>HUBSPOT_CLIENT_SECRET</code> to connect HubSpot.
                Use redirect URI{" "}
                <code className={styles.code}>{base}/api/integrations/hubspot/callback</code>.
              </p>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
