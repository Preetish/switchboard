import { eq } from "drizzle-orm";
import { forms } from "@switchboard/db";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { eraseFormSubmissions, readErasureToken } from "@/lib/erasure";
import styles from "../FormView.module.css";

export const dynamic = "force-dynamic";

/**
 * Where the emailed deletion link lands. Opening the link only shows a
 * confirm button (mail scanners prefetch links); the deletion happens when
 * the lead presses it.
 */
export default async function ConfirmDeletionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string; done?: string }>;
}) {
  const { slug } = await params;
  const { token, done } = await searchParams;
  const request = readErasureToken(token);
  const [form] = await getDb()
    .select({ name: forms.name })
    .from(forms)
    .where(eq(forms.slug, slug))
    .limit(1);

  async function confirm(formData: FormData) {
    "use server";
    const verified = readErasureToken(formData.get("token"));
    if (!verified || verified.slug !== slug) redirect(`/f/${encodeURIComponent(slug)}/delete`);
    await eraseFormSubmissions(getDb(), verified);
    redirect(`/f/${encodeURIComponent(slug)}/delete?done=1`);
  }

  let title: string;
  let body: string;
  let showButton = false;
  if (done) {
    title = "Your data was deleted";
    body = "The details you submitted with this form have been erased.";
  } else if (!request || request.slug !== slug) {
    title = "This link has expired";
    body = "Deletion links work for 24 hours. Request a new one from the form page.";
  } else {
    title = "Delete your data?";
    body = `This erases everything ${request.email} submitted${form ? ` through "${form.name}"` : ""}, including any booked meeting on our side. It can't be undone.`;
    showButton = true;
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.cardTitle}>{title}</h1>
        <p className={styles.cardBody}>{body}</p>
        {showButton ? (
          <form action={confirm}>
            <input type="hidden" name="token" value={token} />
            <button type="submit" className={styles.dangerButton}>
              Delete my data
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
