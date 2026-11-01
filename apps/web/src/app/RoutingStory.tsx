"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./RoutingStory.module.css";

/**
 * The hero visual: a staged replay of one lead's trip through the board,
 * using the demo instance's real rules and a fictional lead. It is a
 * demonstration, not live traffic. Stages auto-advance; with reduced
 * motion the finished state is shown statically.
 */

const STAGE_MS = 3000;
const LAST = 3;

const NODES = [
  { title: "Form submitted", sub: "Book a demo" },
  { title: "Rules evaluated", sub: "3 rules, in order" },
  { title: "Round-robin", sub: "Enterprise team" },
  { title: "Meeting booked", sub: "Tue 9:30 AM ET" },
];

const RULE_ROWS = [
  { name: "Existing owner wins", note: "No owner found", state: "skip" },
  {
    name: "Solo company goes self-serve",
    note: "400 employees, does not apply",
    state: "skip",
  },
  { name: "Teams get a rep", note: "Matched", state: "match" },
] as const;

const WEEK = [
  { day: "Mon", date: "2" },
  { day: "Tue", date: "3" },
  { day: "Wed", date: "4" },
  { day: "Thu", date: "5" },
  { day: "Fri", date: "6" },
];

function Detail({ stage }: { stage: number }) {
  if (stage === 0) {
    return (
      <div className={styles.detailBody}>
        <h3 className={styles.detailTitle}>New submission</h3>
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt>Name</dt>
            <dd>Jane Lee</dd>
          </div>
          <div className={styles.row}>
            <dt>Work email</dt>
            <dd>jane@globex.com</dd>
          </div>
          <div className={styles.row}>
            <dt>Company size</dt>
            <dd>400</dd>
          </div>
          <div className={styles.row}>
            <dt>Country</dt>
            <dd>Canada</dd>
          </div>
        </dl>
      </div>
    );
  }
  if (stage === 1) {
    return (
      <div className={styles.detailBody}>
        <h3 className={styles.detailTitle}>Routing rules</h3>
        <ul className={styles.ruleRows}>
          {RULE_ROWS.map((rule, i) => (
            <li
              key={rule.name}
              className={`${styles.ruleRow} ${
                rule.state === "match" ? styles.ruleMatch : ""
              }`}
              style={{ animationDelay: `${i * 450}ms` }}
            >
              <span className={styles.ruleName}>{rule.name}</span>
              <span className={styles.ruleNote}>
                {rule.state === "match" ? "✓ " : ""}
                {rule.note}
              </span>
            </li>
          ))}
        </ul>
        <p className={styles.detailFoot}>Decided in 31 ms</p>
      </div>
    );
  }
  if (stage === 2) {
    return (
      <div className={styles.detailBody}>
        <h3 className={styles.detailTitle}>Assigned</h3>
        <div className={styles.rep}>
          <span className={styles.avatar} aria-hidden="true">
            AC
          </span>
          <div>
            <p className={styles.repName}>Alice Chen</p>
            <p className={styles.repMeta}>Enterprise team · Round-robin</p>
          </div>
        </div>
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt>Timezone</dt>
            <dd>America/Toronto</dd>
          </div>
          <div className={styles.row}>
            <dt>Capacity</dt>
            <dd>Available</dd>
          </div>
        </dl>
      </div>
    );
  }
  return (
    <div className={styles.detailBody}>
      <h3 className={styles.detailTitle}>Book a demo · Alice Chen</h3>
      <div className={styles.week} aria-hidden="true">
        {WEEK.map((d) => (
          <span
            key={d.day}
            className={`${styles.day} ${d.day === "Tue" ? styles.dayPicked : ""}`}
          >
            <span className={styles.dayName}>{d.day}</span>
            <span className={styles.dayDate}>{d.date}</span>
          </span>
        ))}
      </div>
      <div className={styles.slots} aria-hidden="true">
        <span className={`${styles.slot} ${styles.slotPicked}`}>9:30 AM</span>
        <span className={styles.slot}>10:00 AM</span>
        <span className={styles.slot}>11:30 AM</span>
      </div>
      <p className={styles.detailFoot}>
        <span className={styles.bookedPill}>Booked</span> Tue, Nov 3 · 9:30 AM
        ET · Meet link sent
      </p>
    </div>
  );
}

export default function RoutingStory() {
  const [stage, setStage] = useState(0);
  const [runId, setRunId] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replay = useCallback(() => {
    setStage(0);
    setRunId((n) => n + 1);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStage(LAST);
      return;
    }
    if (stage >= LAST) return;
    timer.current = setTimeout(() => setStage((s) => s + 1), STAGE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [stage, runId]);

  return (
    <div className={styles.canvas}>
      <div className={styles.canvasHead}>
        <span className={styles.liveDot} aria-hidden="true" />
        <span className={styles.canvasLabel}>Inbound workflow</span>
      </div>
      <div className={styles.storyBody}>
        <ol className={styles.flow}>
          {NODES.map((node, i) => {
            // The last stage is the outcome, so it shows as done, not pending.
            const done = i < stage || (stage === LAST && i === LAST);
            return (
              <li
                key={node.title}
                className={`${styles.node} ${
                  done
                    ? styles.nodeDone
                    : i === stage
                      ? styles.nodeActive
                      : styles.nodeTodo
                }`}
              >
                <span className={styles.nodeDot} aria-hidden="true">
                  {done ? "✓" : ""}
                </span>
                <span className={styles.nodeText}>
                  <span className={styles.nodeTitle}>{node.title}</span>
                  <span className={styles.nodeSub}>{node.sub}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <div className={styles.detail} key={`${runId}-${stage}`}>
          <Detail stage={stage} />
        </div>
      </div>
      <div className={styles.canvasFoot}>
        <div className={styles.dots} role="tablist" aria-label="Workflow stage">
          {NODES.map((node, i) => (
            <button
              key={node.title}
              type="button"
              role="tab"
              aria-selected={i === stage}
              aria-label={`Stage ${i + 1}: ${node.title}`}
              className={`${styles.dot} ${i === stage ? styles.dotActive : ""}`}
              onClick={() => setStage(i)}
            />
          ))}
        </div>
        <button type="button" className={styles.replay} onClick={replay}>
          Replay
        </button>
      </div>
    </div>
  );
}
