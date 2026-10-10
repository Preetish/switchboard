import type { DecisionOutcome } from "@switchboard/db";
import { getDb } from "@/lib/db";
import { adminKeyOk, findOrg } from "@/lib/integrations";
import { fetchDecisionLog, outcomeLabel } from "@/lib/decisions-log";

export const dynamic = "force-dynamic";

const BADGE_TONES: Record<DecisionOutcome["kind"], string> = {
  route_user: "var(--sb-success)",
  route_team: "var(--sb-success)",
  self_serve_link: "var(--sb-info)",
  fallback_queue: "var(--sb-warning)",
};

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")}Z`;
}

export default async function RoutingLogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; key?: string }>;
}) {
  const { q, key } = await searchParams;
  const authorized = adminKeyOk(key);
  const rejected = !!key && !authorized;

  const db = getDb();
  const org = authorized ? await findOrg(db) : null;
  const entries = org ? await fetchDecisionLog(db, org.id, { q }) : [];

  return (
    <main style={mainStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontSize: "var(--sb-text-2xl)", fontWeight: 600 }}>Routing log</h1>
        <p style={{ color: "var(--sb-text-muted)", marginTop: "var(--sb-space-1)" }}>
          Every routing decision with its inputs, matched rule, outcome, and latency.
          <br />
          <a href="/integrations" style={{ color: "var(--sb-info)" }}>
            Integrations →
          </a>
        </p>

        {rejected ? (
          <p
            style={{
              marginTop: "var(--sb-space-4)",
              padding: "var(--sb-space-4)",
              borderRadius: "var(--sb-radius-md)",
              fontSize: "var(--sb-text-sm)",
              background: "color-mix(in oklab, var(--sb-danger) 12%, transparent)",
              border: "1px solid var(--sb-danger)",
              color: "var(--sb-text)",
            }}
            role="status"
          >
            That admin key was not accepted. Set <code>ADMIN_SETUP_KEY</code> in your
            environment and try again.
          </p>
        ) : null}

        {authorized && org ? (
          <>
            <form
              action="/routing-log"
              method="get"
              style={{
                marginTop: "var(--sb-space-4)",
                display: "flex",
                gap: "var(--sb-space-2)",
                flexWrap: "wrap",
              }}
            >
              <input type="hidden" name="key" value={key ?? ""} />
              <input
                type="search"
                name="q"
                defaultValue={q ?? ""}
                placeholder="Search lead email, rule, or reason"
                aria-label="Search the routing log"
                style={{ ...inputStyle, flex: "1 1 14rem" }}
              />
              <button type="submit" style={buttonStyle}>
                Search
              </button>
            </form>

            <p
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "var(--sb-space-2)",
                flexWrap: "wrap",
                color: "var(--sb-text-muted)",
                fontSize: "var(--sb-text-sm)",
                marginTop: "var(--sb-space-4)",
              }}
            >
              <span>
                Showing {entries.length} decision{entries.length === 1 ? "" : "s"} (newest
                first){q ? ` matching “${q}”` : ""}.
              </span>
              <form action="/api/decisions/export" method="get">
                <input type="hidden" name="key" value={key ?? ""} />
                {q ? <input type="hidden" name="q" value={q} /> : null}
                <button
                  type="submit"
                  style={{
                    ...buttonStyle,
                    background: "var(--sb-surface)",
                    color: "var(--sb-text)",
                    border: "1px solid var(--sb-border)",
                  }}
                >
                  Download CSV
                </button>
              </form>
            </p>

            {entries.length === 0 ? (
              <p
                style={{
                  marginTop: "var(--sb-space-6)",
                  border: "1px solid var(--sb-border)",
                  borderRadius: "var(--sb-radius-md)",
                  padding: "var(--sb-space-6)",
                  color: "var(--sb-text-muted)",
                  textAlign: "center",
                }}
              >
                {q
                  ? `No decisions match “${q}”.`
                  : "No routing decisions yet. Submit a hosted form to see decisions appear here."}
              </p>
            ) : (
              <div style={{ overflowX: "auto", marginTop: "var(--sb-space-2)" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {["Decided (UTC)", "Lead", "Rule", "Outcome", "Rep / team", "Latency"].map(
                        (heading) => (
                          <th key={heading} scope="col" style={thStyle}>
                            {heading}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const tone = BADGE_TONES[entry.outcome.kind];
                      return (
                        <tr key={entry.id}>
                          <td style={{ ...tdStyle, fontFamily: "var(--sb-font-mono)", whiteSpace: "nowrap" }}>
                            {formatUtc(entry.createdAt)}
                          </td>
                          <td style={tdStyle}>
                            {entry.leadEmail ?? <span style={mutedStyle}>(no email)</span>}
                          </td>
                          <td style={tdStyle}>
                            {entry.matchedRule ?? <span style={mutedStyle}>fallback</span>}
                          </td>
                          <td style={tdStyle}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "0 var(--sb-space-2)",
                                borderRadius: "var(--sb-radius-full)",
                                fontSize: "var(--sb-text-sm)",
                                whiteSpace: "nowrap",
                                background: `color-mix(in oklab, ${tone} 12%, transparent)`,
                                color: tone,
                              }}
                            >
                              {outcomeLabel(entry.outcome.kind)}
                            </span>
                            <div
                              style={{
                                color: "var(--sb-text-muted)",
                                fontSize: "var(--sb-text-sm)",
                                marginTop: "var(--sb-space-1)",
                                maxWidth: "22rem",
                              }}
                            >
                              {entry.outcome.reason}
                            </div>
                          </td>
                          <td style={tdStyle}>
                            {entry.repName ?? entry.teamName ?? (
                              <span style={mutedStyle}>—</span>
                            )}
                          </td>
                          <td style={{ ...tdStyle, fontFamily: "var(--sb-font-mono)", whiteSpace: "nowrap" }}>
                            {entry.latencyMs} ms
                          </td>
                          <td style={tdStyle}>
                            <details>
                              <summary style={{ cursor: "pointer", color: "var(--sb-text-muted)" }}>
                                Inputs
                              </summary>
                              <pre
                                style={{
                                  margin: "var(--sb-space-2) 0 0",
                                  padding: "var(--sb-space-3)",
                                  background: "var(--sb-surface)",
                                  border: "1px solid var(--sb-border)",
                                  borderRadius: "var(--sb-radius-sm)",
                                  fontFamily: "var(--sb-font-mono)",
                                  fontSize: "var(--sb-text-sm)",
                                  maxHeight: "16rem",
                                  overflow: "auto",
                                }}
                              >
                                {JSON.stringify(entry.inputs, null, 2)}
                              </pre>
                            </details>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <form action="/routing-log" method="get" style={{ marginTop: "var(--sb-space-4)" }}>
            {q ? <input type="hidden" name="q" value={q} /> : null}
            <label style={{ display: "block", fontSize: "var(--sb-text-sm)", maxWidth: "24rem" }}>
              <span style={{ display: "block", marginBottom: "var(--sb-space-1)" }}>
                Admin key
              </span>
              <input
                type="password"
                name="key"
                autoComplete="off"
                required
                autoFocus={rejected}
                style={inputStyle}
              />
            </label>
            <button type="submit" style={{ ...buttonStyle, marginTop: "var(--sb-space-3)" }}>
              View log
            </button>
            <p
              style={{
                color: "var(--sb-text-muted)",
                marginTop: "var(--sb-space-3)",
                fontSize: "var(--sb-text-sm)",
              }}
            >
              The routing log holds lead data, so it is protected by the admin key from{" "}
              <code>ADMIN_SETUP_KEY</code> until admin auth (Auth.js) lands.
            </p>
          </form>
        )}
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
  maxWidth: "72rem",
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

const buttonStyle = {
  background: "var(--sb-accent)",
  color: "var(--sb-text-on-accent)",
  border: "none",
  borderRadius: "var(--sb-radius-sm)",
  padding: "var(--sb-space-2) var(--sb-space-4)",
  fontSize: "var(--sb-text-sm)",
  fontWeight: 600,
  cursor: "pointer",
  alignSelf: "flex-end",
} as const;

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "var(--sb-text-sm)",
} as const;

const thStyle = {
  textAlign: "left",
  color: "var(--sb-text-muted)",
  fontWeight: 500,
  padding: "var(--sb-space-2) var(--sb-space-3)",
  borderBottom: "1px solid var(--sb-border)",
  whiteSpace: "nowrap",
} as const;

const tdStyle = {
  padding: "var(--sb-space-3)",
  borderBottom: "1px solid var(--sb-border)",
  verticalAlign: "top",
} as const;

const mutedStyle = {
  color: "var(--sb-text-muted)",
} as const;
