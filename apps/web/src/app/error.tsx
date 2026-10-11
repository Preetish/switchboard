"use client";

import styles from "./f/[slug]/FormView.module.css";

/** Unexpected server errors: say what happened and offer a retry. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.cardTitle}>Something went wrong</h1>
        <p className={styles.cardBody}>
          We couldn&apos;t load this page. It&apos;s usually temporary — try again in a moment.
        </p>
        <button type="button" className={styles.button} onClick={() => reset()}>
          Try again
        </button>
      </section>
    </main>
  );
}
