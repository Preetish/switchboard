import { validateFormFields } from "@switchboard/core";
import { eq } from "drizzle-orm";
import { forms, orgs } from "@switchboard/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { turnstileSiteKey } from "@/lib/captcha";
import { getDb } from "@/lib/db";
import { embedOverrides, resolveFormTheme } from "@/lib/form-theme";
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  // The embed loader (packages/embed) renders this page in an iframe and
  // relies on the height postMessage; see docs/embed.md.
  const embedded = query.embed === "1";
  // The admin Setup page shows forms in a preview that can't submit.
  const preview = query.preview === "1";
  const db = getDb();
  const [row] = await db
    .select({ form: forms, orgName: orgs.name, orgSettings: orgs.settings })
    .from(forms)
    .innerJoin(orgs, eq(forms.orgId, orgs.id))
    .where(eq(forms.slug, slug))
    .limit(1);
  if (!row) notFound();
  const look = resolveFormTheme(row.orgSettings ?? {}, row.form.settings ?? {}, embedOverrides(query));
  const pageClass = `${embedded ? styles.embedPage : styles.page} ${look.className}`;
  const themeTags = (
    <>
      {look.fontStylesheet ? (
        <link rel="stylesheet" href={look.fontStylesheet} precedence="default" />
      ) : null}
      {look.css ? (
        // Built from validated values and admin-written CSS that can't close
        // the tag (packages/core/src/theme.ts).
        <style dangerouslySetInnerHTML={{ __html: look.css }} />
      ) : null}
    </>
  );

  const fields = validateFormFields(row.form.fields);
  if (!fields.ok) {
    return (
      <main className={pageClass}>
        {themeTags}
        <section className={`${styles.card} sb-card`}>
          <h1 className={styles.cardTitle}>This form isn&apos;t available</h1>
          <p className={styles.cardBody}>
            It&apos;s being set up. Please try again later, or contact {row.orgName} directly.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className={pageClass}>
      {themeTags}
      <FormView
        slug={slug}
        orgName={row.orgName}
        formName={row.form.name}
        fields={fields.fields}
        settings={row.form.settings ?? {}}
        embedded={embedded}
        preview={preview}
        turnstileSiteKey={turnstileSiteKey()}
      />
    </main>
  );
}
