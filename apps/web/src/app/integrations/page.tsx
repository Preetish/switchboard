import { and, eq } from "drizzle-orm";
import { integrations } from "@switchboard/db";
import { getDb } from "@/lib/db";
import { findOrg } from "@/lib/integrations";

export const dynamic = "force-dynamic";

const BANNER_STYLES = {
  padding: "var(--sb-space-4)",
  borderRadius: "var(--sb-radius-md)",
  marginBottom: "var(--sb-space-6)",
  fontSize: "var(--sb-text-sm)",
} as const;

const ERRORS: Record<string, string> = {
  admin_key: "That admin key was not accepted. Set ADMIN_SETUP_KEY in your environment and try again.",
  google_not_configured:
    "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (self-hosters bring their own OAuth client — see the README).",
  org_missing:
    "No organization found. Run the migrations and seed script first (npm run db:migrate && npm run db:seed).",
  state_mismatch:
    "The OAuth state did not match — the request may have expired or been tampered with. Nothing was connected; try again.",
  denied: "Google consent was declined. Nothing was connected.",
  exchange_failed:
    "Google rejected the token exchange. Check the OAuth client credentials and redirect URI, then try again.",
};

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const db = getDb();
  const org = await findOrg(db);

  const [google] = org
    ? await db
        .select({
          status: integrations.status,
          scopes: integrations.scopes,
          updatedAt: integrations.updatedAt,
        })
        .from(integrations)
        .where(
          and(eq(integrations.orgId, org.id), eq(integrations.provider, "google_calendar")),
        )
        .limit(1)
    : [];

  const banner = connected
    ? { tone: "ok", text: "Google Calendar is connected. Availability now includes Google free/busy." }
    : error
      ? {
          tone: "error",
          text: ERRORS[error] ?? "Something went wrong connecting the integration. Nothing was changed.",
        }
      : null;
  const bannerTone = banner?.tone === "ok" ? "var(--sb-success)" : "var(--sb-danger)";

  return (
    <main style={mainStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontSize: "var(--sb-text-2xl)", fontWeight: 600 }}>Integrations</h1>
        {org ? (
          <p style={{ color: "var(--sb-text-muted)", marginTop: "var(--sb-space-1)" }}>
            Connections for <strong>{org.name}</strong>.
          </p>
        ) : (
          <p style={{ color: "var(--sb-text-muted)", marginTop: "var(--sb-space-1)" }}>
            No organization found. Run <code>npm run db:migrate &amp;&amp; npm run db:seed</code> first.
          </p>
        )}

        {banner ? (
          <p
            style={{
              ...BANNER_STYLES,
              marginTop: "var(--sb-space-4)",
              background: "color-mix(in oklab, " + bannerTone + " 12%, transparent)",
              border: "1px solid " + bannerTone,
              color: "var(--sb-text)",
            }}
            role="status"
          >
            {banner.text}
          </p>
        ) : null}

        <section
          style={{
            marginTop: "var(--sb-space-6)",
            border: "1px solid var(--sb-border)",
            borderRadius: "var(--sb-radius-md)",
            padding: "var(--sb-space-4)",
          }}
        >
          <h2 style={{ fontSize: "var(--sb-text-lg)", fontWeight: 600 }}>Google Calendar</h2>
          <p style={{ color: "var(--sb-text-muted)", marginTop: "var(--sb-space-1)", fontSize: "var(--sb-text-sm)" }}>
            {google
              ? `Connected (${google.status}) — tokens stored encrypted, updated ${google.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`
              : "Not connected. Free/busy lookup powers real availability when connected."}
          </p>
          <form
            action="/api/integrations/google/connect"
            method="get"
            style={{ marginTop: "var(--sb-space-4)", display: "flex", gap: "var(--sb-space-2)", flexWrap: "wrap" }}
          >
            <label style={{ flex: "1 1 16rem", fontSize: "var(--sb-text-sm)" }}>
              <span style={{ display: "block", marginBottom: "var(--sb-space-1)" }}>Admin key</span>
              <input
                type="password"
                name="key"
                autoComplete="off"
                required
                style={inputStyle}
              />
            </label>
            <button
              type="submit"
              style={{
                alignSelf: "flex-end",
                background: "var(--sb-accent)",
                color: "var(--sb-text-on-accent)",
                border: "none",
                borderRadius: "var(--sb-radius-sm)",
                padding: "var(--sb-space-2) var(--sb-space-4)",
                fontSize: "var(--sb-text-sm)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Connect Google Calendar
            </button>
          </form>
          <p style={{ color: "var(--sb-text-muted)", marginTop: "var(--sb-space-3)", fontSize: "var(--sb-text-sm)" }}>
            The admin key comes from <code>ADMIN_SETUP_KEY</code> and protects this handshake
            until admin auth (Auth.js) lands. Self-hosters use their own Google OAuth client
            with redirect URI <code>/api/integrations/google/callback</code>.
          </p>
        </section>

        <section
          style={{
            marginTop: "var(--sb-space-4)",
            border: "1px solid var(--sb-border)",
            borderRadius: "var(--sb-radius-md)",
            padding: "var(--sb-space-4)",
            opacity: 0.6,
          }}
        >
          <h2 style={{ fontSize: "var(--sb-text-lg)", fontWeight: 600 }}>HubSpot</h2>
          <p style={{ color: "var(--sb-text-muted)", marginTop: "var(--sb-space-1)", fontSize: "var(--sb-text-sm)" }}>
            Coming in a later release — CRM-aware routing (existing-owner wins) and contact write-back.
          </p>
        </section>
      </div>
    </main>
  );
}

const mainStyle = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "var(--sb-space-8) var(--sb-space-4)",
} as const;

const cardStyle = {
  width: "100%",
  maxWidth: "36rem",
} as const;

const inputStyle = {
  width: "100%",
  background: "var(--sb-surface)",
  border: "1px solid var(--sb-border)",
  borderRadius: "var(--sb-radius-sm)",
  padding: "var(--sb-space-2) var(--sb-space-3)",
  fontSize: "var(--sb-text-sm)",
  color: "var(--sb-text)",
} as const;
