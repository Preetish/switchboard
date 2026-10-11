import { validateRuleSet, type RouteAction } from "@switchboard/core";
import { forms, integrations, ruleSets, teamMembers, teams, users } from "@switchboard/db";
import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { adminSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { appBaseUrl, findOrg } from "@/lib/integrations";
import AdminHeader from "../AdminHeader";
import styles from "../admin.module.css";
import CopyButton from "../integrations/CopyButton";

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
 * Read-only view of what switchboard.yaml set up: each form with its link,
 * embed snippet, and rules; each team with its members. Changes happen in
 * the file (reviewed like code), not here.
 */
export default async function SetupPage() {
  if (!(await adminSession())) redirect("/login");
  const db = getDb();
  const org = await findOrg(db);
  const base = appBaseUrl();

  const formRows = org
    ? await db
        .select({ form: forms, rules: ruleSets.rules, version: ruleSets.version })
        .from(forms)
        .leftJoin(ruleSets, eq(forms.ruleSetId, ruleSets.id))
        .where(eq(forms.orgId, org.id))
        .orderBy(asc(forms.createdAt))
    : [];
  const memberRows = org
    ? await db
        .select({
          teamKey: teams.key,
          teamName: teams.name,
          repName: users.name,
          repEmail: users.email,
          weight: teamMembers.weight,
          weeklyCapacity: teamMembers.weeklyCapacity,
          active: teamMembers.active,
          calendar: integrations.status,
        })
        .from(teams)
        .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .leftJoin(
          integrations,
          and(eq(integrations.userId, users.id), eq(integrations.provider, "google_calendar")),
        )
        .where(eq(teams.orgId, org.id))
        .orderBy(asc(teams.key), asc(users.name))
    : [];
  const teamsByKey = new Map<string, { name: string; members: typeof memberRows }>();
  for (const row of memberRows) {
    const team = teamsByKey.get(row.teamKey) ?? { name: row.teamName, members: [] };
    team.members.push(row);
    teamsByKey.set(row.teamKey, team);
  }

  return (
    <>
      <AdminHeader active="setup" />
      <main className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.title}>Setup</h1>
          <p className={styles.subtitle}>
            Forms, rules, and teams from <code className={styles.code}>switchboard.yaml</code>. Edit
            the file and run <code className={styles.code}>npm run config:apply</code> (or restart
            the container) to change them.
          </p>

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

          {teamsByKey.size > 0 ? <h2 className={styles.groupTitle}>Teams</h2> : null}
          {[...teamsByKey.entries()].map(([key, team]) => (
            <section key={key} className={styles.section} aria-labelledby={`team-${key}`}>
              <h3 id={`team-${key}`} className={styles.sectionTitle}>
                {team.name} <span className={styles.muted}>· {key}</span>
              </h3>
              <ul className={styles.list}>
                {team.members.map((member) => (
                  <li key={member.repEmail} className={styles.row}>
                    <div className={styles.rowMain}>
                      <div className={styles.rowName}>{member.repName}</div>
                      <div className={styles.muted}>{member.repEmail}</div>
                    </div>
                    <div className={styles.muted}>
                      {member.active ? `Weight ${member.weight}` : "Paused"}
                      {member.weeklyCapacity > 0 ? ` · max ${member.weeklyCapacity}/week` : ""}
                      {" · "}
                      {member.calendar === "connected"
                        ? "Calendar connected"
                        : member.calendar === "revoked"
                          ? "Calendar needs reconnecting"
                          : "No calendar"}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
