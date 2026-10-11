import styles from "./f/[slug]/FormView.module.css";

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.cardTitle}>Page not found</h1>
        <p className={styles.cardBody}>
          This link doesn&apos;t point to a form or page here. Check the address, or ask
          whoever shared it for the current link.
        </p>
      </section>
    </main>
  );
}
