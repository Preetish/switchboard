import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { clickIdOf, type Attribution } from "@switchboard/core";
import {
  forms,
  routingDecisions,
  submissions,
  teams,
  users,
  type Database,
  type DecisionOutcome,
} from "@switchboard/db";

/**
 * The routing log: read-side helpers for /routing-log and the CSV export.
 * Every decision already stores its inputs, the matched rule, the outcome,
 * and its latency (see submit.ts); this module turns those rows into a
 * searchable page and a flat CSV.
 */

export type DecisionLogEntry = {
  id: string;
  createdAt: Date;
  leadEmail: string | null;
  /** Campaign and click data captured with the submission. */
  attribution: Attribution | null;
  /** Full evaluation inputs ({ form, crm, attribution }) as stored on the decision. */
  inputs: Record<string, unknown>;
  /** Rule that fired; null when only the fallback matched. */
  matchedRule: string | null;
  outcome: DecisionOutcome;
  latencyMs: number;
  formSlug: string | null;
  repName: string | null;
  teamName: string | null;
};

export type DecisionLogOptions = {
  /** Case-insensitive substring match on lead email, rule, reason, UTM source, or campaign. */
  q?: string;
  limit?: number;
};

/** Guard so a malformed outcome id can never be compared to a uuid column. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escape LIKE wildcards so a search for "50%" matches "50%", not "50" + anything. */
export function escapeLikePattern(q: string): string {
  return q.replace(/[\\%_]/g, "\\$&");
}

/** The newest decisions for an org, newest first, with rep/team names resolved. */
export async function fetchDecisionLog(
  db: Database,
  orgId: string,
  options: DecisionLogOptions = {},
): Promise<DecisionLogEntry[]> {
  const limit = Math.min(Math.max(1, options.limit ?? 100), 10_000);
  const search = options.q?.trim() ? `%${escapeLikePattern(options.q.trim())}%` : null;

  const rows = await db
    .select({
      id: routingDecisions.id,
      createdAt: routingDecisions.createdAt,
      inputs: routingDecisions.inputs,
      matchedRule: routingDecisions.matchedRule,
      outcome: routingDecisions.outcome,
      latencyMs: routingDecisions.latencyMs,
      leadEmail: submissions.email,
      attribution: submissions.attribution,
      formSlug: forms.slug,
    })
    .from(routingDecisions)
    .innerJoin(submissions, eq(routingDecisions.submissionId, submissions.id))
    .leftJoin(forms, eq(submissions.formId, forms.id))
    .where(
      search
        ? and(
            eq(routingDecisions.orgId, orgId),
            or(
              ilike(submissions.email, search),
              ilike(routingDecisions.matchedRule, search),
              sql`${submissions.attribution} ->> 'utm_source' ilike ${search}`,
              sql`${submissions.attribution} ->> 'utm_campaign' ilike ${search}`,
              sql`${routingDecisions.outcome} ->> 'reason' ilike ${search}`,
            ),
          )
        : eq(routingDecisions.orgId, orgId),
    )
    .orderBy(desc(routingDecisions.createdAt))
    .limit(limit);

  // Names resolve in two small queries for just the ids on this page.
  const userIds = [
    ...new Set(
      rows
        .map((row) => row.outcome.userId)
        .filter((id): id is string => !!id && UUID_RE.test(id)),
    ),
  ];
  const teamIds = [
    ...new Set(
      rows
        .map((row) => row.outcome.teamId)
        .filter((id): id is string => !!id && UUID_RE.test(id)),
    ),
  ];

  const [userRows, teamRows] = await Promise.all([
    userIds.length
      ? db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([]),
    teamIds.length
      ? db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(inArray(teams.id, teamIds))
      : Promise.resolve([]),
  ]);
  const userNames = new Map(userRows.map((user) => [user.id, user.name] as const));
  const teamNames = new Map(teamRows.map((team) => [team.id, team.name] as const));

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    leadEmail: row.leadEmail,
    attribution: row.attribution,
    inputs: row.inputs,
    matchedRule: row.matchedRule,
    outcome: row.outcome,
    latencyMs: row.latencyMs,
    formSlug: row.formSlug,
    repName: row.outcome.userId ? (userNames.get(row.outcome.userId) ?? null) : null,
    teamName: row.outcome.teamId ? (teamNames.get(row.outcome.teamId) ?? null) : null,
  }));
}

export function outcomeLabel(kind: DecisionOutcome["kind"]): string {
  switch (kind) {
    case "route_user":
      return "Routed to rep";
    case "route_team":
      return "Routed to team";
    case "self_serve_link":
      return "Self-serve link";
    case "fallback_queue":
      return "Fallback queue";
  }
}

/**
 * One RFC 4180 cell: quote when the value contains a comma, quote, or
 * newline, and neutralize formula injection for spreadsheet apps by
 * prefixing a `'` to string cells that open with = + - @, tab, or carriage
 * return (OWASP).
 */
export function csvCell(value: string | number): string {
  let cell = String(value);
  if (typeof value === "string" && /^[=+@\-\t\r]/.test(cell)) cell = `'${cell}`;
  if (/[",\r\n]/.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

export function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(",");
}

export const DECISION_CSV_COLUMNS = [
  "decided_at",
  "lead_email",
  "form",
  "matched_rule",
  "outcome",
  "rep",
  "team",
  "latency_ms",
  "reason",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "click_id",
  "referrer",
  "landing_page",
  "first_utm_source",
  "first_utm_campaign",
] as const;

export type DecisionCsvRow = {
  decidedAt: Date;
  leadEmail: string | null;
  formSlug: string | null;
  matchedRule: string | null;
  outcomeKind: DecisionOutcome["kind"];
  repName: string | null;
  teamName: string | null;
  latencyMs: number;
  reason: string;
  attribution: Attribution | null;
};

export function decisionToCsvRow(entry: DecisionLogEntry): DecisionCsvRow {
  return {
    decidedAt: entry.createdAt,
    leadEmail: entry.leadEmail,
    formSlug: entry.formSlug,
    matchedRule: entry.matchedRule,
    outcomeKind: entry.outcome.kind,
    repName: entry.repName,
    teamName: entry.teamName,
    latencyMs: entry.latencyMs,
    reason: entry.outcome.reason,
    attribution: entry.attribution,
  };
}

const CLICK_PLATFORMS: Record<string, string> = {
  gclid: "Google Ads click",
  gbraid: "Google Ads click",
  wbraid: "Google Ads click",
  fbclid: "Meta ad click",
  msclkid: "Microsoft Ads click",
  li_fat_id: "LinkedIn ad click",
  ttclid: "TikTok ad click",
  twclid: "X ad click",
};

/**
 * A short label for where the lead came from: "google / cpc · spring" from
 * UTMs, a click ID's platform when there are no UTMs, otherwise the
 * referring site.
 */
export function sourceLabel(attribution: Attribution | null): string | null {
  if (!attribution) return null;
  const utm = [attribution.utm_source, attribution.utm_medium].filter(Boolean).join(" / ");
  const campaign = attribution.utm_campaign ? ` · ${attribution.utm_campaign}` : "";
  if (utm) return `${utm}${campaign}`;
  const click = clickIdOf(attribution);
  if (click) return CLICK_PLATFORMS[click.split(":")[0]!] ?? "Ad click";
  if (attribution.referrer) {
    try {
      return new URL(attribution.referrer).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }
  return null;
}

/** Flat machine-readable CSV (CRLF line endings per RFC 4180). */
export function decisionRowsToCsv(rows: DecisionCsvRow[]): string {
  const lines: string[] = [csvRow([...DECISION_CSV_COLUMNS])];
  for (const row of rows) {
    lines.push(
      csvRow([
        row.decidedAt.toISOString(),
        row.leadEmail ?? "",
        row.formSlug ?? "",
        // A null matched_rule means only the fallback fired.
        row.matchedRule ?? "fallback",
        row.outcomeKind,
        row.repName ?? "",
        row.teamName ?? "",
        row.latencyMs,
        row.reason,
        row.attribution?.utm_source ?? "",
        row.attribution?.utm_medium ?? "",
        row.attribution?.utm_campaign ?? "",
        row.attribution?.utm_term ?? "",
        row.attribution?.utm_content ?? "",
        clickIdOf(row.attribution) ?? "",
        row.attribution?.referrer ?? "",
        row.attribution?.landing_page ?? "",
        row.attribution?.first?.utm_source ?? "",
        row.attribution?.first?.utm_campaign ?? "",
      ]),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
