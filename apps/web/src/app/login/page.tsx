import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { adminConfigured } from "@/lib/admin-credentials";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = adminConfigured();

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/integrations",
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
    <main style={mainStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontSize: "var(--sb-text-2xl)", fontWeight: 600 }}>
          Switchboard admin
        </h1>
        <p style={{ color: "var(--sb-text-muted)", marginTop: "var(--sb-space-1)" }}>
          Sign in to manage integrations and the routing log.
        </p>

        {!configured ? (
          <p
            style={{
              marginTop: "var(--sb-space-4)",
              padding: "var(--sb-space-4)",
              borderRadius: "var(--sb-radius-md)",
              fontSize: "var(--sb-text-sm)",
              background: "color-mix(in oklab, var(--sb-warning) 12%, transparent)",
              border: "1px solid var(--sb-warning)",
              color: "var(--sb-text)",
            }}
            role="status"
          >
            Admin auth is not configured. Set <code>ADMIN_EMAIL</code>,{" "}
            <code>ADMIN_PASSWORD</code>, and <code>AUTH_SECRET</code> in your environment
            (see <code>.env.example</code>) and restart.
          </p>
        ) : (
          <form action={login} style={{ marginTop: "var(--sb-space-4)" }}>
            {error ? (
              <div
                role="alert"
                style={{
                  marginBottom: "var(--sb-space-3)",
                  padding: "var(--sb-space-3)",
                  borderRadius: "var(--sb-radius-md)",
                  fontSize: "var(--sb-text-sm)",
                  background: "color-mix(in oklab, var(--sb-danger) 12%, transparent)",
                  border: "1px solid var(--sb-danger)",
                  color: "var(--sb-text)",
                }}
              >
                Invalid email or password.
              </div>
            ) : null}
            <label style={{ display: "block", fontSize: "var(--sb-text-sm)" }}>
              <span style={{ display: "block", marginBottom: "var(--sb-space-1)" }}>
                Email
              </span>
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
                autoFocus
                style={inputStyle}
              />
            </label>
            <label
              style={{
                display: "block",
                fontSize: "var(--sb-text-sm)",
                marginTop: "var(--sb-space-3)",
              }}
            >
              <span style={{ display: "block", marginBottom: "var(--sb-space-1)" }}>
                Password
              </span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                style={inputStyle}
              />
            </label>
            <button
              type="submit"
              style={{ ...buttonStyle, marginTop: "var(--sb-space-4)" }}
            >
              Sign in
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

const mainStyle = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--sb-space-8) var(--sb-space-4)",
} as const;

const cardStyle = {
  width: "100%",
  maxWidth: "22rem",
} as const;

const inputStyle = {
  width: "100%",
  background: "var(--sb-surface)",
  border: "1px solid var(--sb-border)",
  borderRadius: "var(--sb-radius-sm)",
  padding: "var(--sb-space-2) var(--sb-space-3)",
  fontSize: "var(--sb-text-sm)",
  color: "var(--sb-text)",
} as const;

const buttonStyle = {
  width: "100%",
  background: "var(--sb-accent)",
  color: "var(--sb-text-on-accent)",
  border: "none",
  borderRadius: "var(--sb-radius-sm)",
  padding: "var(--sb-space-2) var(--sb-space-4)",
  fontSize: "var(--sb-text-sm)",
  fontWeight: 600,
  cursor: "pointer",
} as const;
