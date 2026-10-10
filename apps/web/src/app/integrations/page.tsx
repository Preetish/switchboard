import { eq } from "drizzle-orm";
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
  admin_key:
    "That admin key was not accepted. Set ADMIN_SETUP_KEY in your environment and try again.",
  google_not_configured:
    "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (self-hosters bring their own OAuth client — see the README).",
  hubspot_not_configured:
    "HubSpot OAuth is not configured. Set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET (self-hosters bring their own HubSpot app — see the README).",
  org_missing:
    "No organization found. Run the migrations and seed script first (npm run db:migrate && npm run db:seed).",
  state_mismatch:
    "The OAuth state did not match — the request may have expired or been tampered with. Nothing was connected; try again.",
  denied: "Consent was declined. Nothing was connected.",
  exchange_failed:
    "The provider rejected the token exchange. Check the OAuth app credentials and redirect URI, then try again.",
};

type ProviderCard = {
  name: string;
  provider: "google_calendar" | "hubspot";
  notConnectedText: string;
  hint: string;
};

const PROVIDERS: ProviderCard[] = [
  {
    name: "Google Calendar",
    provider: "google_calendar",
    notConnectedText:
      "Not connected. Free/busy lookup powers real availability when connected.",
    hint: "Self-hosters use their own Google OAuth client with redirect URI /api/integrations/google/callback.",
  },
  {
    name: "HubSpot",
    provider: "hubspot",
    notConnectedText:
      "Not connected. CRM-aware routing (existing-owner wins) and contact write-back activate when connected.",
    hint: "Self-hosters create their own HubSpot app with redirect URI /api/integrations/hubspot/callback. Rep emails in Switchboard must match the HubSpot owner emails.",
  },
];

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const db = getDb();
  const org = await findOrg(db);

  const rows = org
    ? await db
        .select({
          provider: integrations.provider,
          status: integrations.status,
          scopes: integrations.scopes,
          updatedAt: integrations.updatedAt,
        })
        .from(integrations)
        .where(eq(integrations.orgId, org.id))
    : [];
  const statusByProvider = new Map(rows.map((row) => [row.provider, row] as const));

  const banner = connected
    ? {
        tone: "ok",
        text:
          connected === "hubspot"
            ? "HubSpot is connected. Existing-owner routing and contact write-back are active."
            : "Google Calendar is connected. Availability now includes Google free/busy.",
      }
    : error
      ? {
          tone: "error",
          text:
            ERRORS[error] ??
            "Something went wrong connecting the integration. Nothing was changed.",
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
            No organization found. Run{" "}
            <code>npm run db:migrate &amp;&amp; npm run db:seed</code> first.
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

        {PROVIDERS.map((provider) => {
          const status = statusByProvider.get(provider.provider);
          return (
            <section
              key={provider.provider}
              style={{
                marginTop: "var(--sb-space-4)",
                border: "1px solid var(--sb-border)",
                borderRadius: "var(--sb-radius-md)",
                padding: "var(--sb-space-4)",
              }}
            >
              <h2 style={{ fontSize: "var(--sb-text-lg)", fontWeight: 600 }}>
                {provider.name}
              </h2>
              <p
                style={{
                  color: "var(--sb-text-muted)",
                  marginTop: "var(--sb-space-1)",
                  fontSize: "var(--sb-text-sm)",
                }}
              >
                {status
                  ? `Connected (${status.status}) — tokens stored encrypted, updated ${status.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`
                  : provider.notConnectedText}
              </p>
              <form
                action={`/api/integrations/${provider.provider === "google_calendar" ? "google" : "hubspot"}/connect`}
                method="get"
                style={{
                  marginTop: "var(--sb-space-4)",
                  display: "flex",
                  gap: "var(--sb-space-2)",
                  flexWrap: "wrap",
                }}
              >
                <label style={{ flex: "1 1 16rem", fontSize: "var(--sb-text-sm)" }}>
                  <span style={{ display: "block", marginBottom: "var(--sb-space-1)" }}>
                    Admin key
                  </span>
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
                  Connect {provider.name}
                </button>
              </form>
              <p
                style={{
                  color: "var(--sb-text-muted)",
                  marginTop: "var(--sb-space-3)",
                  fontSize: "var(--sb-text-sm)",
                }}
              >
                The admin key comes from <code>ADMIN_SETUP_KEY</code> and protects this
                handshake until admin auth (Auth.js) lands. {provider.hint}
              </p>
            </section>
          );
        })}
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
