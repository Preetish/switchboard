import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { adminSession, signIn } from "@/lib/auth";
import { adminConfigured } from "@/lib/admin-credentials";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · Switchboard" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await adminSession()) redirect("/routing-log");
  const { error } = await searchParams;
  const configured = adminConfigured();

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/routing-log",
      });
    } catch (cause) {
      // Wrong credentials (or a rate-limited attempt) surface as AuthError;
      // anything else — including the successful-redirect NEXT_REDIRECT —
      // must keep propagating.
      if (cause instanceof AuthError) redirect("/login?error=1");
      throw cause;
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.containerNarrow}>
        <section className={styles.section}>
          <h1 className={styles.title}>Sign in to Switchboard</h1>
          <p className={styles.sectionBody}>
            Manage calendars, integrations, and the routing log.
          </p>

          {!configured ? (
            <p className={styles.bannerError} role="status">
              Admin sign-in isn&apos;t set up. Set <code className={styles.code}>ADMIN_EMAIL</code>,{" "}
              <code className={styles.code}>ADMIN_PASSWORD</code>, and{" "}
              <code className={styles.code}>AUTH_SECRET</code>, then restart. With Docker these
              are generated for you — the password is in the first startup log.
            </p>
          ) : (
            <form action={login} className={styles.stack}>
              {error ? (
                <p className={styles.bannerError} role="alert">
                  That email and password don&apos;t match. Too many attempts are paused for a
                  few minutes.
                </p>
              ) : null}
              <label className={styles.fieldLabel}>
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  required
                  autoFocus
                  className={styles.input}
                />
              </label>
              <label className={styles.fieldLabel}>
                Password
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  className={styles.input}
                />
              </label>
              <button type="submit" className={styles.buttonBlock}>
                Sign in
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
