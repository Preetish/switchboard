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

const LOG_LINES = [
  "jane@globex.com      Teams get a rep → Alice Chen · booked Tue 09:30 ET · 31 ms",
  "ops@beispiel.de     DACH region → Dana Weber · booked Wed 14:00 CET · 28 ms",
  "founder@solo.io     Solo company goes self-serve · 3 ms",
];

const COMPARISON: Array<[string, string, string]> = [
  ["Source", "Open, Apache-2.0", "Closed"],
  ["Hosting", "Your servers", "Their cloud"],
  ["Routing logic", "YAML in your repo", "A vendor console"],
  ["Price", "Free", "Per seat, per month"],
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

/** The patch cord: one accent line from the headline into the live form. */
function PatchCord() {
  return (
    <svg
      className={styles.cord}
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M 2 4 C 30 38, 62 6, 88 26"
        fill="none"
        stroke="var(--sb-accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx="2" cy="4" r="2.2" fill="var(--sb-accent)" />
      <circle
        cx="88"
        cy="26"
        r="3.4"
        fill="none"
        stroke="var(--sb-accent)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx="88" cy="26" r="1.6" fill="var(--sb-accent)" />
    </svg>
  );
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
          <a className={styles.navLink} href="/routing-log">
            Sign in
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
            A connection layer between a stranger&apos;s intent and your
            team&apos;s time.
          </p>
          <p className={styles.triad}>Open. Deterministic. Yours.</p>
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
            <PatchCord />
            <div className={styles.formPanel} id="live-form">
              <div className={styles.formPanelHead}>
                <span className={styles.jackDot} aria-hidden="true" />
                <span>
                  The board, live · the &ldquo;{form.name}&rdquo; form
                </span>
              </div>
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
            <div className={styles.logPanel}>
              {LOG_LINES.map((line) => (
                <p key={line} className={styles.logLine}>
                  {line}
                </p>
              ))}
              <p className={styles.logCaption}>From the board&apos;s log.</p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.hostSection}>
        <h2 className={styles.hostTitle}>Yours to run.</h2>
        <p className={styles.hostBody}>
          Switchboard is open source under Apache-2.0. It runs on a single
          server with Postgres, on infrastructure you already have, and it
          does not phone home. The outcome is a meeting, already on the
          calendar.
        </p>
        <p className={styles.command}>
          <code>docker compose up</code>
        </p>
      </section>

      <section className={styles.compareSection}>
        <h2 className={styles.compareTitle}>An honest comparison.</h2>
        <table className={styles.compare}>
          <thead>
            <tr>
              <th aria-label="Aspect" />
              <th>Switchboard</th>
              <th>Chili Piper</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map(([aspect, ours, theirs]) => (
              <tr key={aspect}>
                <th scope="row">{aspect}</th>
                <td>{ours}</td>
                <td className={styles.theirs}>{theirs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className={styles.footer}>
        <p className={styles.wordmark}>Switchboard</p>
        <p className={styles.footerLine}>
          Apache-2.0 · Runs on your servers ·{" "}
          <a href="https://github.com/Preetish/switchboard" rel="noreferrer">
            GitHub
          </a>{" "}
          · <a href="/routing-log">Sign in</a>
        </p>
      </footer>
    </main>
  );
}
