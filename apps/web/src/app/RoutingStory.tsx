"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./RoutingStory.module.css";

interface Scenario {
  id: string;
  tabLabel: string;
  latencyMs: number;
  lead: {
    name: string;
    email: string;
    companySize: string;
    country: string;
    crmOwner: string;
  };
  matchedRuleIndex: number;
  ruleNotes: [string, string, string, string];
  outcome:
    | {
        kind: "rep";
        repName: string;
        repAvatar: string;
        team: string;
        timezone: string;
        dayLabel: string;
        slots: readonly [string, string, string];
      }
    | {
        kind: "self_serve";
        heading: string;
        note: string;
        ctaLabel: string;
      };
}

const RULE_NAMES = [
  "Existing owner wins",
  "Solo self-serve",
  "DACH region",
  "Teams get a rep",
] as const;

const SCENARIOS: readonly [Scenario, Scenario, Scenario, Scenario] = [
  {
    id: "enterprise",
    tabLabel: "Enterprise · Canada",
    latencyMs: 31,
    lead: {
      name: "Jane Lee",
      email: "jane@globex.com",
      companySize: "400 employees",
      country: "Canada",
      crmOwner: "None",
    },
    matchedRuleIndex: 3,
    ruleNotes: ["No owner", "Size 400", "Canada", "Matched"],
    outcome: {
      kind: "rep",
      repName: "Alice Chen",
      repAvatar: "/reps/alice.jpg",
      team: "Enterprise · Round-robin",
      timezone: "ET",
      dayLabel: "Tue, Nov 3",
      slots: ["9:30 AM", "10:00 AM", "11:30 AM"],
    },
  },
  {
    id: "dach",
    tabLabel: "DACH · Germany",
    latencyMs: 28,
    lead: {
      name: "Lena Hof",
      email: "lena@acme.de",
      companySize: "1,200 employees",
      country: "Germany",
      crmOwner: "None",
    },
    matchedRuleIndex: 2,
    ruleNotes: ["No owner", "Size 1,200", "Matched", ""],
    outcome: {
      kind: "rep",
      repName: "Lukas Weber",
      repAvatar: "/reps/lukas.jpg",
      team: "DACH · Round-robin",
      timezone: "CET",
      dayLabel: "Wed, Nov 4",
      slots: ["10:00 AM", "11:00 AM", "2:30 PM"],
    },
  },
  {
    id: "owner",
    tabLabel: "Existing owner",
    latencyMs: 19,
    lead: {
      name: "Marcus Vance",
      email: "marcus@northstar.io",
      companySize: "250 employees",
      country: "United States",
      crmOwner: "Benito Morales",
    },
    matchedRuleIndex: 0,
    ruleNotes: ["Matched", "", "", ""],
    outcome: {
      kind: "rep",
      repName: "Benito Morales",
      repAvatar: "/reps/benito.jpg",
      team: "Account owner · HubSpot",
      timezone: "PT",
      dayLabel: "Tue, Nov 3",
      slots: ["1:00 PM", "2:00 PM", "4:15 PM"],
    },
  },
  {
    id: "solo",
    tabLabel: "Solo founder",
    latencyMs: 14,
    lead: {
      name: "Sam Patel",
      email: "sam@gmail.com",
      companySize: "1 employee",
      country: "United States",
      crmOwner: "None",
    },
    matchedRuleIndex: 1,
    ruleNotes: ["No owner", "Matched", "", ""],
    outcome: {
      kind: "self_serve",
      heading: "Self-serve onboarding",
      note: "One-person teams get an instant sandbox link instead of booking an enterprise AE.",
      ctaLabel: "Launch interactive sandbox →",
    },
  },
];

// Normalized Y centers (out of 312 viewBox height) for the 4 rule sockets.
const RULE_Y = [36, 115, 194, 273] as const;
const MID_Y = 156;
const CYCLE_MS = 4800;

function curvePath(y1: number, y2: number): string {
  return `M 0 ${y1} C 38 ${y1}, 42 ${y2}, 80 ${y2}`;
}

export default function RoutingStory() {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [pulseKey, setPulseKey] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  const scenario = SCENARIOS[scenarioIdx] ?? SCENARIOS[0];

  const chooseScenario = useCallback((idx: number) => {
    setPlaying(false);
    setScenarioIdx(idx);
    setSelectedSlot(0);
    setPulseKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => {
      setScenarioIdx((prev) => (prev + 1) % SCENARIOS.length);
      setSelectedSlot(0);
      setPulseKey((k) => k + 1);
    }, CYCLE_MS);
    return () => window.clearTimeout(id);
  }, [playing, scenarioIdx]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = stageRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
      el.style.setProperty("--my", `${e.clientY - rect.top}px`);
    },
    [],
  );

  const matchedY = RULE_Y[scenario.matchedRuleIndex] ?? RULE_Y[3];

  return (
    <div
      ref={stageRef}
      className={styles.stage}
      onPointerMove={handlePointerMove}
    >
      <div className={styles.ambientGlow} aria-hidden="true" />
      <div className={styles.pointerSheen} aria-hidden="true" />

      <div className={styles.stageBar}>
        <div className={styles.presets} role="group" aria-label="Try a lead scenario">
          {SCENARIOS.map((item, i) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={i === scenarioIdx}
              className={`${styles.presetBtn} ${
                i === scenarioIdx ? styles.presetActive : ""
              }`}
              onClick={() => chooseScenario(i)}
            >
              {item.tabLabel}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.board}>
        {/* Column 1: Incoming Lead */}
        <div className={styles.card} key={`lead-${scenario.id}`}>
          <span className={styles.cardEyebrow}>Incoming lead</span>
          <p className={styles.leadName}>{scenario.lead.name}</p>
          <p className={styles.leadEmail}>{scenario.lead.email}</p>
          <dl className={styles.metaList}>
            <div className={styles.metaRow}>
              <dt>Company</dt>
              <dd>{scenario.lead.companySize}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt>Country</dt>
              <dd>{scenario.lead.country}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt>HubSpot owner</dt>
              <dd>{scenario.lead.crmOwner}</dd>
            </div>
          </dl>
          <span className={`${styles.jack} ${styles.jackRight}`} aria-hidden="true" />
        </div>

        {/* Wire 1: Lead -> Rules */}
        <svg
          className={styles.wires}
          viewBox="0 0 80 312"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {RULE_Y.map((y, i) => {
            const isActive = i === scenario.matchedRuleIndex;
            const isChecked = i < scenario.matchedRuleIndex;
            return (
              <path
                key={y}
                d={curvePath(MID_Y, y)}
                className={
                  isActive
                    ? styles.wireActive
                    : isChecked
                      ? styles.wireChecked
                      : styles.wireIdle
                }
              />
            );
          })}
          <path
            key={`p1-${pulseKey}`}
            d={curvePath(MID_Y, matchedY)}
            pathLength={100}
            className={styles.wirePulse}
          />
        </svg>

        {/* Mobile vertical flow connector 1 */}
        <div className={styles.mobileFlow} aria-hidden="true">
          <span className={styles.mobileLine} />
          <span className={styles.mobileFlowPill}>↓ Checks 4 rules in order</span>
          <span className={styles.mobileLine} />
        </div>

        {/* Column 2: Rules Board */}
        <div className={styles.rulesWrap}>
          <div className={styles.mobileRulesHead}>
            <span className={styles.cardEyebrow}>Routing rules</span>
            <span className={styles.mobileRulesSub}>First match wins</span>
          </div>
          <ol className={styles.rulesCol} aria-label="Routing rules evaluated in order">
            {RULE_NAMES.map((name, i) => {
              const matched = i === scenario.matchedRuleIndex;
              const skipped = i < scenario.matchedRuleIndex;
              const note = scenario.ruleNotes[i];
              return (
                <li
                  key={name}
                  className={`${styles.ruleNode} ${
                    matched
                      ? styles.ruleMatched
                      : skipped
                        ? styles.ruleSkipped
                        : styles.ruleIdle
                  }`}
                >
                  <span className={styles.ruleIndex}>{i + 1}</span>
                  <span className={styles.ruleLabel}>{name}</span>
                  {matched ? (
                    <span className={styles.ruleStatus}>
                      ✓ {scenario.latencyMs} ms
                    </span>
                  ) : note ? (
                    <span className={styles.ruleStatus}>{note}</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>

        {/* Mobile vertical flow connector 2 */}
        <div className={styles.mobileFlow} aria-hidden="true">
          <span className={styles.mobileLine} />
          <span className={styles.mobileFlowPill}>
            ↓ Matched in {scenario.latencyMs} ms
          </span>
          <span className={styles.mobileLine} />
        </div>

        {/* Wire 2: Matched Rule -> Outcome */}
        <svg
          className={styles.wires}
          viewBox="0 0 80 312"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {RULE_Y.map((y, i) => (
            <path
              key={y}
              d={curvePath(y, MID_Y)}
              className={
                i === scenario.matchedRuleIndex
                  ? styles.wireActive
                  : styles.wireIdle
              }
            />
          ))}
          <path
            key={`p2-${pulseKey}`}
            d={curvePath(matchedY, MID_Y)}
            pathLength={100}
            className={`${styles.wirePulse} ${styles.wirePulseDelayed}`}
          />
        </svg>

        {/* Column 3: Instant Outcome / Calendar */}
        <div className={`${styles.card} ${styles.outcomeCard}`} key={`out-${scenario.id}`}>
          <span className={`${styles.jack} ${styles.jackLeft}`} aria-hidden="true" />
          {scenario.outcome.kind === "rep" ? (
            <>
              <span className={styles.cardEyebrow}>Instant calendar</span>
              <div className={styles.repRow}>
                <div className={styles.avatarWrap}>
                  <Image
                    src={scenario.outcome.repAvatar}
                    alt={scenario.outcome.repName}
                    width={52}
                    height={52}
                    className={styles.avatarImg}
                  />
                  <span className={styles.avatarOnline} aria-hidden="true" />
                </div>
                <div>
                  <p className={styles.repName}>{scenario.outcome.repName}</p>
                  <p className={styles.repMeta}>{scenario.outcome.team}</p>
                </div>
              </div>
              <div className={styles.slotGroup} role="group" aria-label="Pick a demo time">
                {scenario.outcome.slots.map((slot, i) => (
                  <button
                    key={slot}
                    type="button"
                    aria-pressed={i === selectedSlot}
                    className={`${styles.slotBtn} ${
                      i === selectedSlot ? styles.slotSelected : ""
                    }`}
                    onClick={() => {
                      setPlaying(false);
                      setSelectedSlot(i);
                    }}
                  >
                    {slot}
                  </button>
                ))}
              </div>
              <p className={styles.confirmBar}>
                <span className={styles.bookedTag}>Booked</span>
                <span>
                  {scenario.outcome.dayLabel} ·{" "}
                  {scenario.outcome.slots[selectedSlot] ?? scenario.outcome.slots[0]}{" "}
                  {scenario.outcome.timezone} · Meet link sent
                </span>
              </p>
            </>
          ) : (
            <div className={styles.selfServeBox}>
              <span className={styles.cardEyebrow}>Self-serve path</span>
              <p className={styles.selfServeTitle}>{scenario.outcome.heading}</p>
              <p className={styles.selfServeNote}>{scenario.outcome.note}</p>
              <span className={styles.selfServePill}>
                {scenario.outcome.ctaLabel}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
