import { asc, eq } from "drizzle-orm";
import { Instrument_Sans } from "next/font/google";
import Script from "next/script";
import { forms } from "@switchboard/db";
import { getDb } from "@/lib/db";
import { findOrg } from "@/lib/integrations";
import RoutingStory from "./RoutingStory";
import { BookVisual, QualifyVisual, RouteVisual } from "./StepVisuals";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

/**
 * Display face for this page's headlines only (docs/design.md, "The
 * public home page"). Self-hosted by next/font at build time; the token
 * falls back to the system grotesque when the font is unavailable.
 */
const displayFont = Instrument_Sans({
  subsets: ["latin"],
  variable: "--sb-font-display-src",
  display: "swap",
});

const STEPS = [
  {
    title: "Qualify",
    body: "A lead fills in your form. Rules you keep in git read the answers, and your CRM, and decide who should talk to them.",
    visual: <QualifyVisual />,
  },
  {
    title: "Route",
    body: "The board decides in milliseconds: the account owner if there is one, otherwise the next rep on the team, by weight and by capacity.",
    visual: <RouteVisual />,
  },
  {
    title: "Book",
    body: "The lead sees that rep's open times on the same page and books one. The meeting goes onto the rep's calendar with a Meet link.",
    visual: <BookVisual />,
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
    <main className={`${styles.page} ${displayFont.variable}`}>
      <header className={styles.topbar}>
        <div className={styles.barInner}>
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
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroText}>
          <h1 className={styles.title}>
            Inbound routing that ends in a booked meeting.
          </h1>
          <p className={styles.lede}>
            Switchboard is open-source lead routing software. A lead submits
            your form, your rules route them to the right rep, and the
            meeting is booked before they leave the page.
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

        <RoutingStory />
      </section>

      <section className={styles.proof}>
        <div className={styles.proofInner}>
          <p>
            Apache-2.0 · Self-hosted · Works with HubSpot and Google Calendar
            · Rules in YAML, kept in git
          </p>
        </div>
      </section>

      <section className={styles.statement}>
        <p>
          <span className={styles.titleGrey}>
            Leads go cold in the gap between the form and the first reply.{" "}
          </span>
          Switchboard removes the gap: the reply is a calendar, shown before
          the lead leaves the page.
        </p>
      </section>

      <section className={styles.stepsSection}>
        <ol className={styles.steps}>
          {STEPS.map((step, i) => (
            <li key={step.title} className={styles.step}>
              {step.visual}
              <span className={styles.stepNumber}>{i + 1}</span>
              <h2 className={styles.stepTitle}>{step.title}</h2>
              <p className={styles.stepBody}>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.siteSection}>
        <div className={styles.siteInner}>
          <div>
            <h2 className={styles.siteTitle}>On your site, the same day.</h2>
            <p className={styles.siteBody}>
              Switchboard works with the site you already have, or any page
              that can hold a snippet.
            </p>
          </div>
          <ol className={styles.siteSteps}>
            <li className={styles.siteStep}>
              <span className={styles.stepNumber}>1</span>
              <div>
                <h3 className={styles.siteStepTitle}>Add the form</h3>
                <p className={styles.siteStepBody}>
                  One snippet where your form goes, or a link to your hosted
                  form page.
                </p>
                <p className={styles.chips}>
                  <span className={styles.chip}>Webflow</span>
                  <span className={styles.chip}>Framer</span>
                  <span className={styles.chip}>WordPress</span>
                  <span className={styles.chip}>Contentful</span>
                </p>
              </div>
            </li>
            <li className={styles.siteStep}>
              <span className={styles.stepNumber}>2</span>
              <div>
                <h3 className={styles.siteStepTitle}>Connect your tools</h3>
                <p className={styles.siteStepBody}>
                  Two sign-ins. No keys to copy, nothing to paste into
                  settings.
                </p>
                <p className={styles.chips}>
                  <span className={styles.connectPill}>✓ HubSpot</span>
                  <span className={styles.connectPill}>✓ Google Calendar</span>
                </p>
              </div>
            </li>
            <li className={styles.siteStep}>
              <span className={styles.stepNumber}>3</span>
              <div>
                <h3 className={styles.siteStepTitle}>Set the rules once</h3>
                <p className={styles.siteStepBody}>
                  Done with whoever looks after your site. After that, forms,
                  reps, and schedules are yours to change.
                </p>
                <p className={styles.logChip}>
                  <code>Teams get a rep → Alice Chen · 31 ms</code>
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className={styles.darkBand}>
        <div className={styles.darkInner}>
          <div className={styles.darkText}>
            <h2 className={styles.darkTitle}>
              Routing rules live in one YAML file.
            </h2>
            <p className={styles.darkBody}>
              Your rules sit in a single YAML file in your repo, changed the
              way you change code. For every lead, Switchboard checks them
              in order, top to bottom. The routing log then shows which rule
              fired, which rep got the lead, and how long the decision took.
            </p>
          </div>
          <div className={styles.codeStack}>
            <pre className={styles.codePanel}>
              <code>{RULES_EXCERPT}</code>
            </pre>
          </div>
        </div>
      </section>

      {form ? (
        <section className={styles.trySection}>
          <div className={styles.tryInner}>
            <div>
              <h2 className={styles.tryTitle}>Try the demo</h2>
              <p className={styles.tryBody}>
                This form is live, connected to the demo workspace. Fill it
                in and submit, and you will be routed to a rep and shown
                their calendar, exactly as a lead on your site would be.
              </p>
            </div>
            <div className={styles.formPanel} id="live-form">
              <div data-switchboard-form={form.slug} />
              <Script src="/embed.js" strategy="afterInteractive" />
            </div>
          </div>
        </section>
      ) : null}

      <section className={styles.hostSection}>
        <h2 className={styles.hostTitle}>Yours to run.</h2>
        <p className={styles.hostBody}>
          Switchboard is open source under Apache-2.0, running on
          infrastructure you control. Your rules, your data, your servers.
          No per-seat pricing, no lock-in.
        </p>
        <a
          className={styles.hostLink}
          href="https://github.com/Preetish/switchboard"
          rel="noreferrer"
        >
          Read the self-host guide
        </a>
      </section>

      <footer className={styles.footer}>
        <div className={styles.barInner}>
          <p className={styles.wordmark}>Switchboard</p>
          <p className={styles.footerLine}>
            Apache-2.0 · Runs on your servers ·{" "}
            <a href="https://github.com/Preetish/switchboard" rel="noreferrer">
              GitHub
            </a>{" "}
            · <a href="/login">Sign in</a>
          </p>
        </div>
      </footer>
    </main>
  );
}
