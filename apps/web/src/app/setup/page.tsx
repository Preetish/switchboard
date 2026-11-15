import { mergeThemes, validateRuleSet, type RouteAction } from "@switchboard/core";
import { toConfigObject } from "@switchboard/config";
import { forms, integrations, orgs, ruleSets, users } from "@switchboard/db";
import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { adminSession } from "@/lib/auth";
import { getCurrentConfigPlan } from "@/lib/config-admin";
import { getDb } from "@/lib/db";
import { appBaseUrl, findOrg } from "@/lib/integrations";
import AdminHeader from "../AdminHeader";
import styles from "../admin.module.css";
import CopyButton from "../integrations/CopyButton";
import PreviewFrame from "./PreviewFrame";
import RepsTeamsEditor from "./RepsTeamsEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setup · Switchboard" };

function describeRoute(route: RouteAction): string {
  if ("team" in route) {
    return `team ${route.team} (${route.strategy === "existing_owner" ? "CRM owner, else round robin" : "round robin"})`;
  }
  if ("to" in route) return route.to;
  return route.action === "self_serve_link" ? "self-serve" : "fallback queue";
}

/**
 * What switchboard.yaml set up: each form with its link, embed snippet, and
 * rules (read only; those change in the file), then the reps and teams,
 * which can be edited here and saved through the config apply endpoint.
 */
export default async function SetupPage() {
  if (!(await adminSession())) redirect("/login");
  const db = getDb();
  const org = await findOrg(db);
  const base = appBaseUrl();
  const [orgRow] = org
    ? await db.select({ settings: orgs.settings }).from(orgs).where(eq(orgs.id, org.id)).limit(1)
    : [];

  const formRows = org
    ? await db
        .select({ form: forms, rules: ruleSets.rules, version: ruleSets.version })
        .from(forms)
        .leftJoin(ruleSets, eq(forms.ruleSetId, ruleSets.id))
        .where(eq(forms.orgId, org.id))
        .orderBy(asc(forms.createdAt))
    : [];
  const plan = org ? await getCurrentConfigPlan(db, org.id) : null;
  const calendarRows = org
    ? await db
        .select({ email: users.email, status: integrations.status })
        .from(users)
        .innerJoin(
          integrations,
          and(eq(integrations.userId, users.id), eq(integrations.provider, "google_calendar")),
        )
        .where(eq(users.orgId, org.id))
    : [];
  const calendars = Object.fromEntries(calendarRows.map((row) => [row.email.toLowerCase(), row.status]));

  return (
    <>
      <AdminHeader active="setup" />
      <main className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.title}>Setup</h1>
          <p className={styles.subtitle}>
            Forms and rules from <code className={styles.code}>switchboard.yaml</code>. Edit the
            file and run <code className={styles.code}>npm run config:apply</code> (or restart the
            container) to change them. Reps and teams can also be edited below.
          </p>
          {formRows.length > 0 ? (
            <form action="/api/admin/config/export" method="get" className={styles.actions}>
              <button type="submit" className={styles.buttonSecondary}>
                Download YAML
              </button>
            </form>
          ) : null}

          {formRows.length === 0 ? (
            <p className={styles.bannerError}>
              Nothing is set up yet. Copy <code className={styles.code}>switchboard.example.yaml</code>{" "}
              to <code className={styles.code}>switchboard.yaml</code>, fill it in, and apply it.
            </p>
          ) : null}

          {formRows.length > 0 ? <h2 className={styles.groupTitle}>Forms</h2> : null}
          {formRows.map(({ form, rules, version }) => {
            const url = `${base}/f/${form.slug}`;
            const snippet = `<div data-switchboard-form="${form.slug}"></div>\n<script src="${base}/embed.js" data-switchboard-consent="granted" defer></script>`;
            const parsed = rules ? validateRuleSet(rules) : null;
            const scheme = mergeThemes(orgRow?.settings.theme, form.settings?.theme).colorScheme;
            return (
              <section key={form.id} className={styles.section} aria-labelledby={`form-${form.slug}`}>
                <h3 id={`form-${form.slug}`} className={styles.sectionTitle}>
                  {form.name}
                </h3>
                <p className={styles.sectionBody}>
                  <a href={url} className={styles.link}>
                    {url}
                  </a>
                </p>
                <div className={styles.actions}>
                  <CopyButton value={url} label="Copy link" />
                  <CopyButton value={snippet} label="Copy embed code" />
                </div>
                <h4 className={styles.subheading}>Preview</h4>
                <div className={styles.previews}>
                  {scheme === "light" || scheme === "dark" ? (
                    <PreviewFrame slug={form.slug} scheme={null} label={scheme === "light" ? "Light" : "Dark"} />
                  ) : (
                    <>
                      <PreviewFrame slug={form.slug} scheme="light" label="Light (visitors in light mode)" />
                      <PreviewFrame slug={form.slug} scheme="dark" label="Dark (visitors in dark mode)" />
                    </>
                  )}
                </div>
                <h4 className={styles.subheading}>
                  Rules {version ? <span className={styles.muted}>· version {version}</span> : null}
                </h4>
                {parsed?.ok ? (
                  <ol className={styles.ruleList}>
                    {parsed.ruleSet.rules.map((rule) => (
                      <li key={rule.name}>
                        <strong>{rule.name}</strong>
                        <span className={styles.muted}> → {describeRoute(rule.route)}</span>
                      </li>
                    ))}
                    <li>
                      <strong>Otherwise</strong>
                      <span className={styles.muted}> → {describeRoute(parsed.ruleSet.fallback)}</span>
                    </li>
                  </ol>
                ) : (
                  <p className={styles.sectionBody}>
                    {rules ? "These rules no longer validate; leads go to the fallback queue." : "No rules; every lead goes to the fallback queue."}
                  </p>
                )}
              </section>
            );
          })}

          {plan && plan.forms.length > 0 ? (
            <RepsTeamsEditor config={toConfigObject(plan)} calendars={calendars} />
          ) : null}
        </div>
      </main>
    </>
  );
}
