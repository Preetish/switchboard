"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import styles from "./InteractivePlayground.module.css";

type Country = "Canada" | "Germany" | "United States";
type CompanySize = 1 | 50 | 400 | 1200;

interface LogEntry {
  id: number;
  lead: string;
  rule: string;
  rep: string;
  latencyMs: number;
}

interface RuleDefinition {
  ruleIndex: number;
  name: string;
  condition: string;
  destination: string;
}

const COUNTRIES: readonly Country[] = ["Canada", "Germany", "United States"];
const SIZES: readonly CompanySize[] = [1, 50, 400, 1200];

const INITIAL_LOG: readonly LogEntry[] = [
  {
    id: 1,
    lead: "jane@globex.com",
    rule: "Teams get a rep",
    rep: "Alice Chen",
    latencyMs: 31,
  },
  {
    id: 2,
    lead: "lena@acme.de",
    rule: "DACH region",
    rep: "Lukas Weber",
    latencyMs: 28,
  },
  {
    id: 3,
    lead: "marcus@northstar.io",
    rule: "Existing owner wins",
    rep: "Benito Morales",
    latencyMs: 19,
  },
  {
    id: 4,
    lead: "sam@gmail.com",
    rule: "Solo self-serve",
    rep: "Self-serve",
    latencyMs: 14,
  },
  {
    id: 5,
    lead: "alex@acme.io",
    rule: "Teams get a rep",
    rep: "Claire Wright",
    latencyMs: 26,
  },
  {
    id: 6,
    lead: "nina@zurich.ch",
    rule: "DACH region",
    rep: "Lukas Weber",
    latencyMs: 24,
  },
];

const RULES: readonly RuleDefinition[] = [
  {
    ruleIndex: 0,
    name: "Existing owner wins",
    condition: "HubSpot owner exists",
    destination: "Contact owner",
  },
  {
    ruleIndex: 1,
    name: "Solo self-serve",
    condition: "Company size is 1",
    destination: "Self-serve link",
  },
  {
    ruleIndex: 2,
    name: "DACH region",
    condition: "Country is Germany, Austria, or Switzerland",
    destination: "DACH team",
  },
  {
    ruleIndex: 3,
    name: "Teams get a rep",
    condition: "Company size is 2+",
    destination: "Enterprise team",
  },
];

function evaluateLead(country: Country, size: CompanySize, hasOwner: boolean) {
  if (hasOwner) {
    return {
      matchedIndex: 0,
      rule: "Existing owner wins",
      rep: "Benito Morales",
      avatar: "/reps/benito.jpg",
      team: "Account owner · HubSpot",
      latencyMs: 19,
      reasons: ["Matched", "Not reached", "Not reached", "Not reached"],
    };
  }
  if (size <= 1) {
    return {
      matchedIndex: 1,
      rule: "Solo self-serve",
      rep: "Self-serve",
      avatar: null,
      team: "Instant product sandbox",
      latencyMs: 14,
      reasons: ["No owner", "Matched", "Not reached", "Not reached"],
    };
  }
  if (country === "Germany") {
    return {
      matchedIndex: 2,
      rule: "DACH region",
      rep: "Lukas Weber",
      avatar: "/reps/lukas.jpg",
      team: "DACH team · Round-robin",
      latencyMs: 28,
      reasons: ["No owner", `Size ${size.toLocaleString()}`, "Matched", "Not reached"],
    };
  }
  return {
    matchedIndex: 3,
    rule: "Teams get a rep",
    rep: size >= 400 ? "Alice Chen" : "Claire Wright",
    avatar: size >= 400 ? "/reps/alice.jpg" : "/reps/claire.jpg",
    team: "Enterprise team · Round-robin",
    latencyMs: 31,
    reasons: [
      "No owner",
      `Size ${size.toLocaleString()}`,
      country,
      "Matched",
    ],
  };
}

export default function InteractivePlayground() {
  const [country, setCountry] = useState<Country>("Germany");
  const [size, setSize] = useState<CompanySize>(1200);
  const [hasOwner, setHasOwner] = useState(false);

  const result = useMemo(
    () => evaluateLead(country, size, hasOwner),
    [country, size, hasOwner],
  );

  return (
    <div className={styles.workbench}>
      {/* Interactive lead controls */}
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Country</span>
          <div className={styles.pillRow} role="group" aria-label="Lead country">
            {COUNTRIES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={country === c}
                className={`${styles.pillBtn} ${
                  country === c ? styles.pillActive : ""
                }`}
                onClick={() => setCountry(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Company size</span>
          <div className={styles.pillRow} role="group" aria-label="Lead company size">
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={size === s}
                className={`${styles.pillBtn} ${
                  size === s ? styles.pillActive : ""
                }`}
                onClick={() => setSize(s)}
              >
                {s.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>HubSpot owner</span>
          <div className={styles.pillRow} role="group" aria-label="HubSpot existing owner">
            <button
              type="button"
              aria-pressed={!hasOwner}
              className={`${styles.pillBtn} ${!hasOwner ? styles.pillActive : ""}`}
              onClick={() => setHasOwner(false)}
            >
              None
            </button>
            <button
              type="button"
              aria-pressed={hasOwner}
              className={`${styles.pillBtn} ${hasOwner ? styles.pillActive : ""}`}
              onClick={() => setHasOwner(true)}
            >
              Benito Morales
            </button>
          </div>
        </div>
      </div>

      {/* Bento 3-card interactive grid */}
      <div className={styles.bento}>
        {/* Wide top card: Live simulator */}
        <div className={`${styles.panel} ${styles.panelWide}`}>
          <div className={styles.panelHead}>
            <div>
              <h3 className={styles.panelTitle}>Test before applying</h3>
              <p className={styles.panelSub}>
                Toggle any input above—Switchboard evaluates your rules in order
                without touching live traffic.
              </p>
            </div>
          </div>

          <div className={styles.simSplit}>
            <ol className={styles.traceList} aria-label="Evaluated rules">
              {RULES.map((rule, i) => {
                const matched = i === result.matchedIndex;
                const skipped = i < result.matchedIndex;
                return (
                  <li
                    key={rule.name}
                    className={`${styles.traceRow} ${
                      matched
                        ? styles.traceMatched
                        : skipped
                          ? styles.traceSkipped
                          : styles.traceIdle
                    }`}
                  >
                    <span className={styles.traceNum}>{i + 1}</span>
                    <span className={styles.traceName}>{rule.name}</span>
                    <span className={styles.traceNote}>
                      {matched ? "✓ " : ""}
                      {result.reasons[i]}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className={styles.mobileArrow} aria-hidden="true">
              <span className={styles.mobileArrowLine} />
              <span className={styles.mobileArrowPill}>
                ↓ Routed in {result.latencyMs} ms
              </span>
              <span className={styles.mobileArrowLine} />
            </div>

            <div className={styles.outcomeBox}>
              <span className={styles.outcomeEyebrow}>Routed outcome</span>
              <div className={styles.outcomePerson}>
                {result.avatar ? (
                  <Image
                    src={result.avatar}
                    alt={result.rep}
                    width={48}
                    height={48}
                    className={styles.outcomeAvatar}
                  />
                ) : (
                  <span className={styles.selfServeIcon} aria-hidden="true">
                    →
                  </span>
                )}
                <div>
                  <p className={styles.outcomeName}>{result.rep}</p>
                  <p className={styles.outcomeTeam}>{result.team}</p>
                </div>
              </div>
              <div className={styles.outcomeStats}>
                <div>
                  <span className={styles.statLabel}>Matched rule</span>
                  <span className={styles.statVal}>{result.rule}</span>
                </div>
                <div>
                  <span className={styles.statLabel}>Decision time</span>
                  <span className={`${styles.statVal} ${styles.mono}`}>
                    {result.latencyMs} ms
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom left: Full routing log */}
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h3 className={styles.panelTitle}>Full routing log</h3>
              <p className={styles.panelSub}>
                Every submission records the inputs, matched rule, rep, and
                decision time.
              </p>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.logTable}>
              <caption className={styles.srOnly}>Sample routing log</caption>
              <thead>
                <tr>
                  <th scope="col">Lead</th>
                  <th scope="col">Rule</th>
                  <th scope="col">Rep</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {INITIAL_LOG.map((row) => (
                  <tr key={row.id}>
                    <td className={styles.monoCell}>{row.lead}</td>
                    <td>{row.rule}</td>
                    <td>{row.rep}</td>
                    <td className={styles.mono}>{row.latencyMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.panelFooter}>
            <span>{INITIAL_LOG.length} recent decisions · Searchable &amp; CSV exportable</span>
            <span className={styles.mono}>
              Avg{" "}
              {Math.round(
                INITIAL_LOG.reduce((sum, row) => sum + row.latencyMs, 0) /
                  INITIAL_LOG.length,
              )}{" "}
              ms
            </span>
          </div>
        </div>

        {/* Bottom right: Plain-English Sentence Builder preview */}
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h3 className={styles.panelTitle}>Plain-English rules</h3>
              <p className={styles.panelSub}>
                Pick fields, conditions, and teams from dropdowns on the Setup
                page.
              </p>
            </div>
          </div>

          <ol className={styles.plainRuleList} aria-label="Plain-English routing rules">
            {RULES.map((rule) => {
              const active = rule.ruleIndex === result.matchedIndex;
              return (
                <li
                  key={rule.name}
                  className={`${styles.plainRuleRow} ${
                    active ? styles.plainRuleActive : ""
                  }`}
                >
                  <span className={styles.plainRuleNum}>
                    {rule.ruleIndex + 1}
                  </span>
                  <div className={styles.plainRuleBody}>
                    <p className={styles.plainRuleCond}>{rule.condition}</p>
                    <p className={styles.plainRuleDest}>
                      <span className={styles.plainRuleArrow} aria-hidden="true">
                        →
                      </span>
                      <span>{rule.destination}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className={styles.panelFooter}>
            <span>Saved automatically · Exportable anytime as a backup file</span>
          </div>
        </div>
      </div>
    </div>
  );
}
