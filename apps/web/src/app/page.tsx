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
    body: "A lead fills in your form. Rules you write as sentences on the Setup page read the answers, and your CRM, and decide who should talk to them.",
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

const RULES_EXCERPT = `1. Existing owner wins
   When HubSpot contact owner exists
   then route to the HubSpot contact owner

2. DACH region
   When Country is any of Germany, Austria, Switzerland
   then route to team DACH, take turns

3. Teams get a rep
   When Company size is at least 2
   then route to team Enterprise, take turns

Otherwise route to team Sales, take turns`;



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
            · Set up in the app, exported as YAML for review in git
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
        <StepsSequence className={styles.steps}>
          {STEPS.map((step, i) => (
            <li key={step.title} className={styles.step}>
              {step.visual}
              <span className={styles.stepNumber}>{i + 1}</span>
              <h2 className={styles.stepTitle}>{step.title}</h2>
              <p className={styles.stepBody}>{step.body}</p>
            </li>
          ))}
        </StepsSequence>
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
          <div className={styles.darkText}>
            <h2 className={styles.darkTitle}>
              Routing rules are written as sentences.
            </h2>
            <p className={styles.darkBody}>
              You write each rule on the Setup page as a sentence, try a test
              lead in the simulator, and review the changes before you apply
              them. For every lead, Switchboard checks the rules in order, top
              to bottom. The routing log then shows which rule fired, which
              rep got the lead, and how long the decision took. Underneath,
              the rules are saved as YAML, which you can download to review
              and keep in git.
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
      {analyticsScript()}
    </main>
  );
}
