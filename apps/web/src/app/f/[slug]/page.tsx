import { validateFormFields } from "@switchboard/core";
import { eq } from "drizzle-orm";
import { forms, orgs } from "@switchboard/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { turnstileSiteKey } from "@/lib/captcha";
import { getDb } from "@/lib/db";
import FormView from "./FormView";
import styles from "./FormView.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const [row] = await getDb()
      .select({ name: forms.name, orgName: orgs.name })
      .from(forms)
      .innerJoin(orgs, eq(forms.orgId, orgs.id))
      .where(eq(forms.slug, slug))
      .limit(1);
    if (row) return { title: `${row.name} · ${row.orgName}` };
  } catch {
    // Metadata is best-effort; the page itself reports the real error.
  }
  return { title: "Switchboard" };
}

export default async function FormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ embed?: string }>;
}) {
  const { slug } = await params;
  const { embed } = await searchParams;
  // The embed loader (packages/embed) renders this page in an iframe and
  // relies on the height postMessage; see docs/embed.md.
  const embedded = embed === "1";
  const db = getDb();
  const [row] = await db
    .select({ form: forms, orgName: orgs.name })
    .from(forms)
    .innerJoin(orgs, eq(forms.orgId, orgs.id))
    .where(eq(forms.slug, slug))
    .limit(1);
  if (!row) notFound();

  const fields = validateFormFields(row.form.fields);
  if (!fields.ok) {
    return (
      <main className={embedded ? styles.embedPage : styles.page}>
        <section className={styles.card}>
          <h1 className={styles.cardTitle}>This form isn&apos;t available</h1>
          <p className={styles.cardBody}>
            It&apos;s being set up. Please try again later, or contact {row.orgName} directly.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className={embedded ? styles.embedPage : styles.page}>
      <FormView
        slug={slug}
        orgName={row.orgName}
        formName={row.form.name}
        fields={fields.fields}
        settings={row.form.settings ?? {}}
        embedded={embedded}
        turnstileSiteKey={turnstileSiteKey()}
      />
    </main>
  );
}
