"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Plays the How-it-works visuals one step at a time instead of looping all
 * three at once. A step plays once when it is on screen and the step before
 * it has finished, so a desktop row runs 1 → 2 → 3 and a phone column plays
 * each step as it scrolls in. Without JS, or with reduced motion, nothing is
 * marked and every visual shows its finished state.
 */

// How long each step's animation runs (its last element lands before this).
const STEP_MS = [2600, 2900, 3300];

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
    const timers: number[] = [];
    let next = 0;
    let running = false;

    const advance = () => {
      const i = next;
      const step = steps[i];
      if (running || !step || !visible.has(i)) return;
      running = true;
      step.dataset.stepState = "playing";
      timers.push(
        window.setTimeout(() => {
          delete step.dataset.stepState;
          running = false;
          next = i + 1;
          advance();
        }, STEP_MS[i] ?? 3000),
      );
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const i = steps.indexOf(entry.target as HTMLElement);
          if (entry.isIntersecting) visible.add(i);
          else visible.delete(i);
        }
        advance();
      },
      { threshold: 0.6 },
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
