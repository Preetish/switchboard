import { validateFormFields } from "@switchboard/core";
import { eq } from "drizzle-orm";
import { forms, orgs } from "@switchboard/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import FormView from "./FormView";

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
    if (row) return { title: `${row.name} — ${row.orgName}` };
  } catch {
    // Metadata is best-effort; the page itself reports the real error.
  }
  return { title: "Switchboard" };
}

export default async function FormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
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
      <main style={mainStyle}>
        <div
          style={{
            background: "var(--sb-surface)",
            border: "1px solid var(--sb-border)",
            borderRadius: "var(--sb-radius-lg)",
            padding: "var(--sb-space-8)",
            maxWidth: "34rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "var(--sb-text-2xl)", fontWeight: 600 }}>
            This form is misconfigured
          </h1>
          <p style={{ color: "var(--sb-text-muted)", marginTop: "var(--sb-space-2)" }}>
            Its field definitions failed validation. Contact the team that owns this form.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <FormView
        slug={slug}
        orgName={row.orgName}
        formName={row.form.name}
        fields={fields.fields}
      />
    </main>
  );
}

const mainStyle = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--sb-space-6)",
} as const;
