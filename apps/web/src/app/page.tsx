import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import Script from "next/script";
import { forms } from "@switchboard/db";
import { getDb } from "@/lib/db";
import { appBaseUrl, findOrg } from "@/lib/integrations";
import RoutingStory from "./RoutingStory";
import StepsSequence from "./StepsSequence";
import { BookVisual, QualifyVisual, RouteVisual } from "./StepVisuals";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

const SHARE_TITLE = "Switchboard: inbound routing that ends in a booked meeting";
const SHARE_DESCRIPTION =
  "Open-source lead routing. A lead submits your form, your rules route them to the right rep, and the meeting is booked before they leave the page.";

/**
 * Link previews for the home page only. Hosted form pages keep their own
 * titles and no Switchboard image, since their links belong to the
 * customer. APP_BASE_URL makes the image URL absolute, as crawlers need.
 */
export function generateMetadata(): Metadata {
  const image = {
    url: "/og.png",
    width: 1200,
    height: 630,
    alt: "Switchboard: a lead's request goes through the rules, round robin picks a rep, and the meeting is booked.",
  };
  return {
    metadataBase: new URL(appBaseUrl()),
    // Instances stay out of search results unless the operator opts the home
    // page in; forms and admin pages keep the layout's noindex either way.
    ...(process.env.HOME_PAGE_INDEXABLE === "true"
      ? { robots: { index: true, follow: true } }
      : {}),
    openGraph: {
      type: "website",
      siteName: "Switchboard",
      title: SHARE_TITLE,
      description: SHARE_DESCRIPTION,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: SHARE_TITLE,
      description: SHARE_DESCRIPTION,
      images: [image],
    },
  };
}

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
    body: "A lead fills in your form. Rules you write on the Setup page read the answers, and your CRM, and decide who should talk to them.",
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

const LOG_ROWS = [
  {
    lead: "jane@globex.com",
    rule: "Teams get a rep",
    rep: "Alice Chen",
    latency: "31 ms",
  },
  {
    lead: "lena@acme.de",
    rule: "DACH region",
    rep: "Lukas Weber",
    latency: "28 ms",
  },
  {
    lead: "sam@gmail.com",
    rule: "Solo self-serve",
    rep: "Self-serve",
    latency: "14 ms",
  },
];

const YAML_EXCERPT = `teams:
  - key: dach
    members: [lukas@acme.com]

rules:
  - name: DACH region
    when:
      form.country: { in: [Germany, Austria, Switzerland] }
    route: { team: dach, strategy: round_robin }`;



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

/** Optional page-view analytics for the home page (Umami: cookie-free). */
function analyticsScript() {
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  if (!websiteId) return null;
  const src = process.env.UMAMI_SCRIPT_URL || "https://cloud.umami.is/script.js";
  return <Script src={src} data-website-id={websiteId} strategy="afterInteractive" />;
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
              className={styles.navIconLink}
              href="https://github.com/Preetish/switchboard"
              rel="noreferrer"
              aria-label="GitHub"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
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
          <ul className={styles.proofList} role="list">
            <li className={styles.proofItem}>
              <svg
                className={styles.proofIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 1.75 13 3.75v4c0 3.25-2.15 5.65-5 6.5-2.85-.85-5-3.25-5-6.5v-4l5-2Z" />
                <path d="m5.75 8 1.5 1.5 3-3" />
              </svg>
              <span>Apache-2.0</span>
            </li>
            <li className={styles.proofItem}>
              <svg
                className={styles.proofIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2.25" y="2.5" width="11.5" height="4.5" rx="1.25" />
                <rect x="2.25" y="9" width="11.5" height="4.5" rx="1.25" />
                <circle cx="4.75" cy="4.75" r="0.65" fill="currentColor" stroke="none" />
                <circle cx="4.75" cy="11.25" r="0.65" fill="currentColor" stroke="none" />
              </svg>
              <span>Self-hosted</span>
            </li>
            <li className={styles.proofItem}>
              <svg
                className={styles.proofIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="8" cy="8.5" r="2.35" />
                <circle cx="8" cy="2.75" r="1.25" fill="currentColor" stroke="none" />
                <circle cx="13" cy="11.5" r="1.25" fill="currentColor" stroke="none" />
                <circle cx="3" cy="11.5" r="1.25" fill="currentColor" stroke="none" />
                <path d="M8 4v2.15M10.05 9.7l1.9 1.1M5.95 9.7l-1.9 1.1" />
              </svg>
              <span>HubSpot</span>
            </li>
            <li className={styles.proofItem}>
              <svg
                className={styles.proofIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2.25" y="3" width="11.5" height="10.75" rx="1.5" />
                <path d="M5.25 1.75v2.25M10.75 1.75v2.25M2.25 6.25h11.5" />
                <rect x="5.25" y="8.5" width="2" height="2" rx="0.4" fill="currentColor" stroke="none" />
              </svg>
              <span>Google Calendar</span>
            </li>
          </ul>
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
        <StepsSequence className={styles.steps}>
          {STEPS.map((step) => (
            <li key={step.title} className={styles.step}>
              {step.visual}
              <h2 className={styles.stepTitle}>{step.title}</h2>
              <p className={styles.stepBody}>{step.body}</p>
            </li>
          ))}
        </StepsSequence>
      </section>

      <section className={styles.siteSection}>
        <div className={styles.siteInner}>
          <div>
            <h2 className={styles.siteTitle}>
              On your site,
              <br />
              the same day.
            </h2>
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
                  Pick reps from your HubSpot owners, write the rules as
                  sentences, try a test lead in the simulator, and apply.
                  You can change any of it later on the same page.
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
          <div className={styles.darkIntro}>
            <h2 className={styles.darkIntroTitle}>
              Routing rules
              <br />
              written as sentences.
            </h2>
            <p className={styles.darkIntroBody}>
              Switchboard checks your rules top to bottom on every lead. Test
              changes safely, audit every match, and export your setup anytime.
            </p>
          </div>

          <div className={styles.darkRow}>
            <div className={styles.darkText}>
              <h3 className={styles.darkTitle}>Test before applying.</h3>
              <p className={styles.darkBody}>
                Try any lead in the simulator and review the diff before your
                changes go live.
              </p>
            </div>
            <div className={styles.codePanel}>
              <div className={styles.panelHead}>
                <span className={styles.panelTitle}>Simulator</span>
                <span className={styles.panelMeta}>No changes saved</span>
              </div>
              <div className={styles.simInputs}>
                <span className={styles.simChip}>lena@globex.example</span>
                <span className={styles.simChip}>1,200 employees</span>
                <span className={styles.simChip}>Germany</span>
              </div>
              <div className={styles.simResult}>
                <p className={styles.simMatch}>✓ Matched: DACH region</p>
                <p className={styles.simMeta}>
                  Assigned to Lukas Weber · DACH team · 28 ms
                </p>
              </div>
            </div>
          </div>

          <div className={`${styles.darkRow} ${styles.darkRowFlip}`}>
            <div className={styles.darkText}>
              <h3 className={styles.darkTitle}>Full routing log.</h3>
              <p className={styles.darkBody}>
                See which rule fired, which rep got the lead, and how long the
                decision took.
              </p>
            </div>
            <div className={styles.codePanel}>
              <div className={styles.tableWrap}>
                <table className={styles.logTable}>
                  <caption className={styles.visuallyHidden}>
                    Sample routing log entries
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Lead</th>
                      <th scope="col">Rule</th>
                      <th scope="col">Rep</th>
                      <th scope="col">Decision time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LOG_ROWS.map((row) => (
                      <tr key={row.lead}>
                        <td>{row.lead}</td>
                        <td>{row.rule}</td>
                        <td>{row.rep}</td>
                        <td className={styles.logMono}>{row.latency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className={styles.darkRow}>
            <div className={styles.darkText}>
              <h3 className={styles.darkTitle}>
                Back up or move your setup anytime.
              </h3>
              <p className={styles.darkBody}>
                Download your reps, teams, and rules as one readable file.
              </p>
            </div>
            <div className={styles.codePanel}>
              <div className={styles.panelHead}>
                <span className={styles.panelTitle}>switchboard.yaml</span>
              </div>
              <pre className={styles.yamlCode}>
                <code>{YAML_EXCERPT}</code>
              </pre>
            </div>
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
            </a>
          </p>
        </div>
      </footer>
      {analyticsScript()}
    </main>
  );
}
