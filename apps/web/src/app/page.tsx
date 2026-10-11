import { asc, eq } from "drizzle-orm";
import { forms } from "@switchboard/db";
import { getDb } from "@/lib/db";
import { findOrg } from "@/lib/integrations";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    title: "Qualify",
    body: "A lead fills in your form. Rules you keep in git read the answers and your CRM and decide who should talk to them.",
  },
  {
    title: "Route",
    body: "Switchboard picks the rep in milliseconds: the account owner if there is one, otherwise the next rep on the team, by weight.",
  },
  {
    title: "Book",
    body: "The lead sees that rep's open times on the same page and books one. The meeting goes onto the rep's calendar with a Meet link.",
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
          Switchboard sends each form submission to the right rep and lets the lead book a
          time on that rep&apos;s calendar before leaving the page. It&apos;s open source and
          runs on your own servers.
        </p>
        <div className={styles.actions}>
          {form ? (
            <a className={styles.primary} href={`/f/${form.slug}`}>
              Try the &quot;{form.name}&quot; form
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
