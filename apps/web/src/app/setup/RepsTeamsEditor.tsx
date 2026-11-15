"use client";

import type { ApplySummary, ConfigInput } from "@switchboard/config";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "../admin.module.css";
import AddRepForm, { NO_OWNER_WARNING, type OwnersState } from "./AddRepForm";
import {
  DAYS,
  buildConfig,
  draftsFromConfig,
  hasOwnerWithEmail,
  newRep,
  placeErrors,
  type HubspotOwner,
  type MemberDraft,
  type PlacedErrors,
  type RepDraft,
  type TeamDraft,
} from "./reps-teams";

export type CalendarStatus = "connected" | "expired" | "revoked";

type SaveResult = { kind: "saved"; summary: ApplySummary } | { kind: "failed"; errors: PlacedErrors };

const DAY_LABELS: Record<(typeof DAYS)[number], string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

function calendarLabel(status: CalendarStatus | undefined): string {
  if (status === "connected") return "Calendar connected";
  if (status === "revoked") return "Calendar needs reconnecting";
  return "No calendar";
}

function savedMessage(summary: ApplySummary): string {
  const added = summary.reps.created;
  return `Saved.${added > 0 ? ` Added ${added} rep${added === 1 ? "" : "s"}.` : ""} Changes apply to new leads.`;
}

/**
 * Edit reps and team memberships in place. Edits stay in this page until
 * Save changes, which sends the whole config (forms, rules, and theme as
 * loaded) to POST /api/admin/config/apply. A config with any problem is
 * not applied; its errors show next to the rep or team they name.
 */
export default function RepsTeamsEditor({
  config,
  calendars,
}: {
  /** The current config as getCurrentConfigPlan and toConfigObject read it. */
  config: ConfigInput;
  /** Calendar status by lowercased rep email. */
  calendars: Record<string, CalendarStatus>;
}) {
  const router = useRouter();
  const [base, setBase] = useState(config);
  const [reps, setReps] = useState(() => draftsFromConfig(config).reps);
  const [teams, setTeams] = useState(() => draftsFromConfig(config).teams);
  const [owners, setOwners] = useState<OwnersState>({ status: "loading" });
  const [timeZones, setTimeZones] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const nextId = useRef(0);

  // After a save, the page data is refreshed: start over from what was saved.
  if (config !== base) {
    const drafts = draftsFromConfig(config);
    setBase(config);
    setReps(drafts.reps);
    setTeams(drafts.teams);
  }

  useEffect(() => {
    // Filled in after hydration: the server's zone list may differ from the browser's.
    setTimeZones(Intl.supportedValuesOf("timeZone"));
    let cancelled = false;
    fetch("/api/admin/hubspot/owners")
      .then(async (response) => {
        if (cancelled) return;
        if (response.ok) {
          setOwners({ status: "ready", owners: (await response.json()) as HubspotOwner[] });
        } else if (response.status === 404) {
          setOwners({ status: "not-connected" });
        } else {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          setOwners({ status: "error", message: payload?.error ?? "HubSpot owners couldn't be loaded. Type the rep's email." });
        }
      })
      .catch(() => {
        if (!cancelled) setOwners({ status: "error", message: "HubSpot owners couldn't be loaded. Type the rep's email." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateRep = (id: string, change: Partial<RepDraft>) =>
    setReps((current) => current.map((rep) => (rep.id === id ? { ...rep, ...change } : rep)));
  const updateTeam = (key: string, members: (members: MemberDraft[]) => MemberDraft[]) =>
    setTeams((current) => current.map((team) => (team.key === key ? { ...team, members: members(team.members) } : team)));
  const updateMember = (teamKey: string, repId: string, change: Partial<MemberDraft>) =>
    updateTeam(teamKey, (members) => members.map((member) => (member.repId === repId ? { ...member, ...change } : member)));

  const save = async () => {
    setSaving(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/config/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildConfig(base, reps, teams)),
      });
      const payload = (await response.json().catch(() => null)) as (ApplySummary & { errors?: unknown }) | null;
      if (response.ok && payload) {
        setResult({ kind: "saved", summary: payload });
        router.refresh();
      } else {
        const errors = Array.isArray(payload?.errors)
          ? (payload.errors as string[])
          : [`Saving failed (HTTP ${response.status}). Nothing was changed; try again.`];
        setResult({ kind: "failed", errors: placeErrors(errors) });
      }
    } catch {
      setResult({
        kind: "failed",
        errors: placeErrors(["The server couldn't be reached. Nothing was changed; check your connection and try again."]),
      });
    } finally {
      setSaving(false);
    }
  };

  const errors = result?.kind === "failed" ? result.errors : null;
  const repById = new Map(reps.map((rep) => [rep.id, rep]));
  const repEmails = new Set(reps.map((rep) => rep.email.trim().toLowerCase()));
  const ownerList = owners.status === "ready" ? owners.owners : null;

  return (
    // Its own box, so the sticky save bar stays with the reps and teams.
    <div>
      <h2 className={styles.groupTitle}>Reps and teams</h2>
      <p className={styles.sectionBody}>
        Edit reps and who is on each team, then save. Applying{" "}
        <code className={styles.code}>switchboard.yaml</code> again replaces these changes, so
        download the YAML afterwards if you keep the file.
      </p>
      {errors && errors.other.length > 0 ? (
        <div className={styles.bannerError} role="alert">
          These problems stopped the save:
          <ul className={styles.errorList}>
            {errors.other.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="reps-heading">
        <h3 id="reps-heading" className={styles.sectionTitle}>
          Reps
        </h3>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Rep</th>
                <th scope="col">Working hours</th>
                <th scope="col">Teams</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((rep, index) => (
                <tr key={rep.id}>
                  <td>
                    <div className={styles.cellStack}>
                      <label className={styles.inlineLabel}>
                        Name
                        <input
                          className={styles.inputSmall}
                          value={rep.name}
                          onChange={(event) => updateRep(rep.id, { name: event.target.value })}
                        />
                      </label>
                      <label className={styles.inlineLabel}>
                        Email
                        <input
                          className={styles.inputSmall}
                          type="email"
                          value={rep.email}
                          onChange={(event) => updateRep(rep.id, { email: event.target.value })}
                        />
                      </label>
                      {ownerList && rep.email.trim() && !hasOwnerWithEmail(ownerList, rep.email) ? (
                        <p className={styles.warning}>
                          <span className={styles.dotWarn} aria-hidden="true" />
                          {NO_OWNER_WARNING}
                        </p>
                      ) : null}
                      {rep.savedEmail && rep.savedEmail.toLowerCase() !== rep.email.trim().toLowerCase() ? (
                        <p className={styles.muted}>
                          Saving adds this as a new rep; {rep.savedEmail} stays listed with no teams.
                        </p>
                      ) : null}
                      <span className={styles.muted}>
                        {rep.savedEmail ? calendarLabel(calendars[rep.savedEmail.toLowerCase()]) : "Not saved yet"}
                      </span>
                      <FieldErrors errors={errors?.reps.get(index)} />
                    </div>
                  </td>
                  <td>
                    <div className={styles.cellStack}>
                      <label className={styles.inlineLabel}>
                        Timezone
                        <input
                          className={styles.inputSmall}
                          list="setup-time-zones"
                          value={rep.timezone}
                          onChange={(event) => updateRep(rep.id, { timezone: event.target.value })}
                        />
                      </label>
                      <div role="group" aria-label={`Working days for ${rep.name || rep.email}`} className={styles.days}>
                        {DAYS.map((day) => (
                          <label key={day} className={styles.dayChip}>
                            <input
                              type="checkbox"
                              checked={rep.days.includes(day)}
                              onChange={(event) =>
                                updateRep(rep.id, {
                                  days: event.target.checked ? [...rep.days, day] : rep.days.filter((d) => d !== day),
                                })
                              }
                            />
                            {DAY_LABELS[day]}
                          </label>
                        ))}
                      </div>
                      <label className={styles.inlineLabel}>
                        Hours
                        <input
                          className={styles.inputSmall}
                          placeholder="Any time, or 09:00-17:00"
                          value={rep.hours}
                          onChange={(event) => updateRep(rep.id, { hours: event.target.value })}
                        />
                      </label>
                    </div>
                  </td>
                  <td>
                    <div className={styles.cellStack}>
                      {teams.flatMap((team) =>
                        team.members
                          .filter((member) => member.repId === rep.id)
                          .map((member) => (
                            <div key={team.key} className={styles.membership}>
                              <div className={styles.rowName}>{team.name}</div>
                              <MemberControls
                                label={`${rep.name || rep.email} in ${team.name}`}
                                member={member}
                                onChange={(change) => updateMember(team.key, rep.id, change)}
                              />
                            </div>
                          )),
                      )}
                      {teams.every((team) => team.members.every((member) => member.repId !== rep.id)) ? (
                        <span className={styles.muted}>Not on a team</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <datalist id="setup-time-zones">
          {timeZones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <AddRepForm
          owners={owners}
          repEmails={repEmails}
          onAdd={(fields) =>
            setReps((current) => [
              ...current,
              newRep(`new-${nextId.current++}`, {
                ...fields,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
              }),
            ])
          }
        />
      </section>

      {teams.map((team, index) => (
        <TeamCard
          key={team.key}
          team={team}
          reps={reps}
          repById={repById}
          errors={errors?.teams.get(index)}
          onMemberChange={(repId, change) => updateMember(team.key, repId, change)}
          onAdd={(repId) =>
            updateTeam(team.key, (members) => [...members, { repId, weight: 1, weeklyCapacity: 0, active: true }])
          }
          onRemove={(repId) => updateTeam(team.key, (members) => members.filter((member) => member.repId !== repId))}
        />
      ))}

      <div className={styles.saveBar}>
        <button type="button" className={styles.button} onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <span aria-live="polite" className={styles.muted}>
          {result?.kind === "saved" ? savedMessage(result.summary) : null}
          {result?.kind === "failed" ? "Nothing was saved. Fix the problems shown and save again." : null}
        </span>
      </div>
    </div>
  );
}

function FieldErrors({ errors }: { errors: string[] | undefined }) {
  if (!errors?.length) return null;
  return (
    <ul className={styles.fieldError}>
      {errors.map((error) => (
        <li key={error}>{error}</li>
      ))}
    </ul>
  );
}

function MemberControls({
  label,
  member,
  onChange,
}: {
  label: string;
  member: MemberDraft;
  onChange: (change: Partial<MemberDraft>) => void;
}) {
  return (
    <div role="group" aria-label={label} className={styles.memberControls}>
      <label className={styles.inlineLabel}>
        Weight
        <input
          className={styles.inputNumber}
          type="number"
          min={1}
          max={100}
          value={Number.isNaN(member.weight) ? "" : member.weight}
          onChange={(event) => onChange({ weight: event.target.valueAsNumber })}
        />
      </label>
      <label className={styles.inlineLabel}>
        Max per week
        <input
          className={styles.inputNumber}
          type="number"
          min={0}
          max={1000}
          title="0 means no weekly cap"
          value={Number.isNaN(member.weeklyCapacity) ? "" : member.weeklyCapacity}
          onChange={(event) => onChange({ weeklyCapacity: event.target.valueAsNumber })}
        />
      </label>
      <label className={styles.checkLabel}>
        <input type="checkbox" checked={!member.active} onChange={(event) => onChange({ active: !event.target.checked })} />
        Paused
      </label>
    </div>
  );
}

function TeamCard({
  team,
  reps,
  repById,
  errors,
  onMemberChange,
  onAdd,
  onRemove,
}: {
  team: TeamDraft;
  reps: RepDraft[];
  repById: Map<string, RepDraft>;
  errors: string[] | undefined;
  onMemberChange: (repId: string, change: Partial<MemberDraft>) => void;
  onAdd: (repId: string) => void;
  onRemove: (repId: string) => void;
}) {
  const [adding, setAdding] = useState("");
  const outside = reps.filter((rep) => !team.members.some((member) => member.repId === rep.id));
  return (
    <section className={styles.section} aria-labelledby={`team-${team.key}`}>
      <h3 id={`team-${team.key}`} className={styles.sectionTitle}>
        {team.name} <span className={styles.muted}>· {team.key}</span>
      </h3>
      <FieldErrors errors={errors} />
      {team.members.length === 0 ? <p className={styles.sectionBody}>No members. Add a rep below.</p> : null}
      <ul className={styles.list}>
        {team.members.map((member) => {
          const rep = repById.get(member.repId);
          const who = rep?.name || rep?.email || "Unknown rep";
          return (
            <li key={member.repId} className={styles.row}>
              <div className={styles.rowMain}>
                <div className={styles.rowName}>{who}</div>
                <div className={styles.muted}>{member.active ? rep?.email : `Paused · ${rep?.email}`}</div>
              </div>
              <MemberControls label={`${who} in ${team.name}`} member={member} onChange={(change) => onMemberChange(member.repId, change)} />
              <button
                type="button"
                className={styles.buttonSecondary}
                aria-label={`Remove ${who} from ${team.name}`}
                onClick={() => onRemove(member.repId)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      {outside.length > 0 ? (
        <form
          className={styles.inlineForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (!adding) return;
            onAdd(adding);
            setAdding("");
          }}
        >
          <label className={styles.inlineLabel}>
            Add a rep to {team.name}
            <select className={styles.inputSmall} value={adding} onChange={(event) => setAdding(event.target.value)}>
              <option value="">Choose a rep</option>
              {outside.map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.name || rep.email}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={styles.buttonSecondary} disabled={!adding}>
            Add to team
          </button>
        </form>
      ) : null}
    </section>
  );
}
