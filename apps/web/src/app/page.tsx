import { asc, eq } from "drizzle-orm";
import { Fraunces } from "next/font/google";
import Script from "next/script";
import { forms } from "@switchboard/db";
import { getDb } from "@/lib/db";
import { findOrg } from "@/lib/integrations";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

/**
 * Display serif for this page's headlines only (docs/design.md, "The
 * public home page"). Self-hosted by next/font at build time; the token
 * falls back to a local serif when the font is unavailable.
 */
const displaySerif = Fraunces({
  subsets: ["latin"],
  variable: "--sb-font-display-src",
  display: "swap",
});

const STEPS = [
  {
    title: "Qualify",
    body: "A lead fills in your form. Rules you keep in git read the answers, and your CRM, and decide who should talk to them.",
  },
  {
    title: "Route",
    body: "The board decides in milliseconds: the account owner if there is one, otherwise the next rep on the team, by weight and by capacity.",
  },
  {
    title: "Book",
    body: "The lead sees that rep's open times on the same page and books one. The meeting goes onto the rep's calendar with a Meet link.",
  },
];

const RULES_EXCERPT = `rules:
  - name: Existing owner wins
    when: { crm.contact.owner: exists }
    route: { to: crm.contact.owner }

  - name: Solo company goes self-serve
    when: { form.company_size: { lte: 1 } }
    route: { action: self_serve_link, message: "…" }

  - name: Teams get a rep
    when: { form.company_size: { gt: 1 } }
    route: { team: enterprise, strategy: round_robin }`;



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
    <main className={`${styles.page} ${displaySerif.variable}`}>
      <header className={styles.topbar}>
        <p className={styles.wordmark}>Switchboard</p>
        <nav className={styles.topnav}>
          <a
            className={styles.navLink}
            href="https://github.com/Preetish/switchboard"
            rel="noreferrer"
          >
            GitHub
          </a>
          {form ? (
            <a className={styles.navCta} href="#live-form">
              Try the demo
            </a>
          ) : null}
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroText}>
          <h1 className={styles.title}>
            <span className={styles.titleGrey}>
              This is the first conversation,{" "}
            </span>
            connected the way it always should have been.
          </h1>
          <p className={styles.lede}>
            Switchboard is open source. A lead submits your form, your rules
            route them to the right rep, and the meeting is booked before
            they leave the page.
          </p>
          <div className={styles.actions}>
            {form ? (
              <a className={styles.primary} href="#live-form">
                See it work
              </a>
            ) : null}
            <a
              className={styles.secondary}
              href="https://github.com/Preetish/switchboard"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>

        {form ? (
          <div className={styles.stage}>
            <div className={styles.formPanel} id="live-form">
              <div data-switchboard-form={form.slug} />
              <Script src="/embed.js" strategy="afterInteractive" />
            </div>
            <p className={styles.stageCaption}>
              This is the product, running. Submit it, and watch what happens.
            </p>
          </div>
        ) : null}
      </section>

      <section className={styles.statement}>
        <p>
          <span className={styles.titleGrey}>
            Somewhere between the form and the calendar, intent goes quiet.
            Most companies never hear it happen.{" "}
          </span>
          Switchboard exists in that interval.
        </p>
      </section>

      <section className={styles.stepsSection}>
        <ol className={styles.steps}>
          {STEPS.map((step, i) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepNumber}>{i + 1}</span>
              <h2 className={styles.stepTitle}>{step.title}</h2>
              <p className={styles.stepBody}>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.darkBand}>
        <div className={styles.darkInner}>
          <div className={styles.darkText}>
            <h2 className={styles.darkTitle}>
              <span className={styles.darkTitleGrey}>The rules are yours, </span>
              kept where your code lives.
            </h2>
            <p className={styles.darkBody}>
              Nothing about the decision is hidden in a console. It is a file.
              It can be read, reviewed, and changed the way code is changed,
              and every decision it makes is written down.
            </p>
          </div>
          <div className={styles.codeStack}>
            <pre className={styles.codePanel}>
              <code>{RULES_EXCERPT}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className={styles.hostSection}>
        <h2 className={styles.hostTitle}>Yours to run.</h2>
        <p className={styles.hostBody}>
          Switchboard is open source under Apache-2.0. It runs on a single
          server with Postgres, on infrastructure you already have. The
          outcome is a meeting, already on the calendar.
        </p>
        <p className={styles.command}>
          <code>docker compose up</code>
        </p>
      </section>

      <footer className={styles.footer}>
        <p className={styles.wordmark}>Switchboard</p>
        <p className={styles.footerLine}>
          Apache-2.0 · Runs on your servers ·{" "}
          <a href="https://github.com/Preetish/switchboard" rel="noreferrer">
            GitHub
          </a>{" "}
          · <a href="/login">Sign in</a>
        </p>
      </footer>
    </main>
  );
}
