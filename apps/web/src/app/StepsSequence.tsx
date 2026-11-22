"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Plays the How-it-works visuals in a crisp left-to-right cascade once they
 * scroll into view (instead of keeping later cards blank for 5+ seconds).
 * Without JS or with reduced motion, nothing is marked and every visual shows
 * its finished state immediately.
 */

// Delay before triggering the next step in the cascade, and total play window
// before clearing the playing attribute back to the clean finished state.
const CASCADE_MS = 650;
const FINISH_MS = [1600, 1900, 1900];

export default function StepsSequence({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const steps = Array.from(list.children) as HTMLElement[];
    steps.forEach((step) => (step.dataset.stepState = "waiting"));

    const visible = new Set<number>();
    const started = new Set<number>();
    const timers: number[] = [];
    let next = 0;

    const kickOff = () => {
      const i = next;
      const step = steps[i];
      if (!step || started.has(i) || !visible.has(i)) return;
      started.add(i);
      step.dataset.stepState = "playing";
      next = i + 1;

      timers.push(
        window.setTimeout(() => {
          delete step.dataset.stepState;
        }, FINISH_MS[i] ?? 1900),
      );

      if (next < steps.length) {
        timers.push(window.setTimeout(kickOff, CASCADE_MS));
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const i = steps.indexOf(entry.target as HTMLElement);
          if (entry.isIntersecting) visible.add(i);
        }
        kickOff();
      },
      { threshold: 0.25 },
    );
    steps.forEach((step) => observer.observe(step));

    return () => {
      observer.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
      steps.forEach((step) => delete step.dataset.stepState);
    };
  }, []);

  return (
    <ol ref={ref} className={className}>
      {children}
    </ol>
  );
}
