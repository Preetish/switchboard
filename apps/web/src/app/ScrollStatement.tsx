"use client";

import { useEffect, useRef } from "react";
import styles from "./ScrollStatement.module.css";

const SENTENCE_ONE =
  "Leads go cold in the gap between the form and the first reply.".split(" ");
const SENTENCE_TWO =
  "Switchboard closes it by opening the right rep's calendar the moment they hit submit.".split(
    " ",
  );
const ALL_WORDS = [...SENTENCE_ONE, ...SENTENCE_TWO];

/**
 * Editorial statement whose words illuminate smoothly one by one from soft
 * gray into deep obsidian ink as the visitor scrolls through it. Updates
 * compositor-only `opacity` directly on word refs in `requestAnimationFrame`
 * (zero React re-renders during scroll) and stays static under
 * `prefers-reduced-motion: reduce`.
 */
export default function ScrollStatement() {
  const sectionRef = useRef<HTMLElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      return;
    }

    const total = ALL_WORDS.length;
    const windowWords = 4;
    let raf = 0;

    const update = () => {
      raf = 0;
      // Map illumination cleanly across the dedicated section's passage
      // through the center of the viewport so words light up as you read.
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const center = rect.top + rect.height / 2;
      const start = vh * 0.92;
      const end = vh * 0.36;
      const raw = (start - center) / (start - end);
      const progress = Math.max(0, Math.min(1, raw));
      const cursor = progress * (total + windowWords);

      for (let i = 0; i < total; i += 1) {
        const el = wordRefs.current[i];
        if (!el) continue;
        const t = Math.max(0, Math.min(1, (cursor - i) / windowWords));
        el.style.opacity = (0.18 + t * 0.82).toFixed(3);
      }
    };

    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
      for (const el of wordRefs.current) {
        if (el) el.style.removeProperty("opacity");
      }
    };
  }, []);

  return (
    <section ref={sectionRef} className={styles.statement}>
      <p className={styles.copy}>
        {ALL_WORDS.map((word, i) => (
          <span key={`${word}-${i}`}>
            <span
              ref={(el) => {
                wordRefs.current[i] = el;
              }}
              className={`${styles.word} ${
                i < SENTENCE_ONE.length ? styles.wordMutedStatic : ""
              }`}
            >
              {word}
            </span>
            {i < ALL_WORDS.length - 1 ? " " : ""}
          </span>
        ))}
      </p>
    </section>
  );
}
