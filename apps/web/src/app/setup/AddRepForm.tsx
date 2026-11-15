"use client";

import { useState, type FormEvent } from "react";
import styles from "../admin.module.css";
import { fieldsFromOwner, hasOwnerWithEmail, type HubspotOwner } from "./reps-teams";

/** GET /api/admin/hubspot/owners, as the editor loaded it. */
export type OwnersState =
  | { status: "loading" }
  | { status: "ready"; owners: HubspotOwner[] }
  | { status: "not-connected" }
  | { status: "error"; message: string };

export const NO_OWNER_WARNING =
  "No HubSpot owner matches this email; routing by CRM owner will not find this rep.";

/**
 * Add a rep: pick a HubSpot owner (fills name and email, so the email join
 * key matches HubSpot exactly) or type them. The rep is added to the list;
 * nothing is saved until Save changes.
 */
export default function AddRepForm({
  owners,
  repEmails,
  onAdd,
}: {
  owners: OwnersState;
  /** Emails already on the list, lowercased. */
  repEmails: Set<string>;
  onAdd: (fields: { name: string; email: string }) => void;
}) {
  const [ownerId, setOwnerId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const available = owners.status === "ready" ? owners.owners.filter((owner) => !repEmails.has(owner.email.toLowerCase())) : [];
  const showOwnerWarning = owners.status === "ready" && email.trim() !== "" && !hasOwnerWithEmail(owners.owners, email);

  const pick = (id: string) => {
    setOwnerId(id);
    const owner = available.find((candidate) => candidate.id === id);
    if (!owner) return;
    const fields = fieldsFromOwner(owner);
    setName(fields.name);
    setEmail(fields.email);
    setProblem(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !email.trim()) {
      setProblem("Enter a name and an email.");
      return;
    }
    if (repEmails.has(email.trim().toLowerCase())) {
      setProblem(`${email.trim()} is already a rep.`);
      return;
    }
    onAdd({ name, email: email.trim() });
    setOwnerId("");
    setName("");
    setEmail("");
    setProblem(null);
  };

  return (
    <form onSubmit={submit} aria-labelledby="add-rep-heading">
      <h4 id="add-rep-heading" className={styles.subheading}>
        Add a rep
      </h4>
      <div className={styles.formGrid}>
        {owners.status === "ready" ? (
          <label className={styles.inlineLabel}>
            HubSpot owner
            <select className={styles.inputSmall} value={ownerId} onChange={(event) => pick(event.target.value)}>
              <option value="">
                {available.length > 0
                  ? "Choose an owner"
                  : owners.owners.length > 0
                    ? "Every owner is already a rep"
                    : "HubSpot has no owners with an email"}
              </option>
              {available.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name ? `${owner.name} (${owner.email})` : owner.email}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className={styles.inlineLabel}>
            HubSpot owner
            <span className={styles.warning}>
              {owners.status === "loading" ? (
                "Loading HubSpot owners…"
              ) : owners.status === "not-connected" ? (
                <a href="/integrations" className={styles.link}>
                  Connect HubSpot to pick owners
                </a>
              ) : (
                owners.message
              )}
            </span>
          </div>
        )}
        <label className={styles.inlineLabel}>
          Name
          <input className={styles.inputSmall} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className={styles.inlineLabel}>
          Email
          <input
            className={styles.inputSmall}
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setOwnerId("");
            }}
          />
        </label>
      </div>
      {showOwnerWarning ? (
        <p className={styles.warning}>
          <span className={styles.dotWarn} aria-hidden="true" />
          {NO_OWNER_WARNING}
        </p>
      ) : null}
      {problem ? (
        <p className={styles.fieldError} role="alert">
          {problem}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button type="submit" className={styles.buttonSecondary}>
          Add rep
        </button>
      </div>
    </form>
  );
}
