import styles from "../../admin.module.css";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  link_invalid:
    "This connect link is invalid or has expired. Ask your Switchboard admin for a new one.",
  state_mismatch: "The request expired before it finished. Open your connect link again.",
  denied: "You declined access, so nothing was connected. Open your link again to retry.",
  scope_missing:
    "Calendar access was only partly granted. Open your link again and keep both calendar permissions ticked.",
  google_not_configured: "Google isn't set up on this Switchboard yet. Let your admin know.",
  auth_not_configured: "This Switchboard isn't fully configured yet. Let your admin know.",
  rep_missing: "Your rep profile no longer exists. Let your admin know.",
  org_missing: "This Switchboard isn't fully configured yet. Let your admin know.",
  exchange_failed: "Google rejected the connection. Try again, or let your admin know.",
};

/**
 * Where a rep lands after connecting their calendar from a connect link.
 * Reps have no admin access, so this page is public and says only what
 * happened.
 */
export default async function ConnectResultPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const ok = Boolean(connected) && !error;
  return (
    <main className={styles.page}>
      <div className={styles.containerNarrow}>
        <section className={styles.section}>
          <h1 className={styles.title}>
            {ok ? "Your calendar is connected" : "Calendar not connected"}
          </h1>
          <p className={styles.sectionBody}>
            {ok
              ? "Leads routed to you will only see times you're free, and booked meetings will appear on your Google Calendar. You can close this tab."
              : (ERRORS[error ?? ""] ?? "Something went wrong. Open your connect link again.")}
          </p>
        </section>
      </div>
    </main>
  );
}
