import { asc, eq } from "drizzle-orm";
import { forms } from "@switchboard/db";
import { getDb } from "@/lib/db";
import { findOrg } from "@/lib/integrations";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    title: "Qualify",
    body: "A lead fills in your form. Rules you keep in git decide where they go, using form answers and your CRM.",
  },
  {
    title: "Route",
    body: "The right rep is picked in milliseconds — existing owner, team round robin with weights, capacity, and time off.",
  },
  {
    title: "Book",
    body: "That rep's real availability appears on the same page. One click, and the meeting is on their calendar.",
  },
];

/** The first form, so a fresh instance has an obvious "try it" link. */
async function firstForm(): Promise<{ slug: string; name: string } | null> {
  try {
    const db = getDb();
    const org = await findOrg(db);
    if (!org) return null;
    const [form] = await db
      .select({ slug: forms.slug, name: forms.name })
      .from(forms)
      .where(eq(forms.orgId, org.id))
      .orderBy(asc(forms.createdAt))
      .limit(1);
    return form ?? null;
  } catch {
    return null;
  }
}

export default async function Home() {
  const form = await firstForm();
  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <p className={styles.brand}>Switchboard</p>
        <h1 className={styles.title}>Inbound routing that ends in a booked meeting.</h1>
        <p className={styles.lede}>
          Qualify a form submission, route it to the right rep, and let the lead book on that
          rep&apos;s calendar before they leave the page. Open source and self-hosted.
        </p>
        <div className={styles.actions}>
          {form ? (
            <a className={styles.primary} href={`/f/${form.slug}`}>
              Try “{form.name}”
            </a>
          ) : null}
          <a className={styles.secondary} href="/routing-log">
            Sign in
          </a>
          <a
            className={styles.secondary}
            href="https://github.com/Preetish/switchboard"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
      </div>
      <ol className={styles.steps}>
        {STEPS.map((step, i) => (
          <li key={step.title} className={styles.step}>
            <span className={styles.stepNumber}>{i + 1}</span>
            <h2 className={styles.stepTitle}>{step.title}</h2>
            <p className={styles.stepBody}>{step.body}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
