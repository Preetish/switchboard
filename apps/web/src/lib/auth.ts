import { createHash } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyAdminCredentials } from "./admin-credentials";
import { checkRateLimit, clientIp } from "./rate-limit";

/** Sessions last a week; changing ADMIN_PASSWORD ends them all sooner. */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * A short fingerprint of the current admin credentials. It is stored in the
 * session token at sign-in and checked on every request, so rotating
 * `ADMIN_PASSWORD` (or the email) signs out every existing session.
 */
function credentialsFingerprint(): string {
  return createHash("sha256")
    .update(`${process.env.ADMIN_EMAIL ?? ""}\n${process.env.ADMIN_PASSWORD ?? ""}`)
    .digest("base64url")
    .slice(0, 16);
}

/**
 * Admin auth: a single admin account configured from the environment, with
 * a JWT session cookie. The admin pages, OAuth handshakes, and CSV export
 * require it.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Self-hosters run behind proxies and on non-localhost hosts.
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  providers: [
    Credentials({
      name: "Admin",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        // Brute-force guard, per address and across all addresses: once a
        // window is exhausted, attempts are rejected before the password is
        // compared; the login page shows the same message either way.
        const ip = request ? clientIp(request) : "unknown";
        if (!checkRateLimit("login", ip).allowed) return null;
        if (!checkRateLimit("loginGlobal", "all").allowed) return null;
        return verifyAdminCredentials(credentials?.email, credentials?.password);
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.cf = credentialsFingerprint();
      return token;
    },
    session({ session, token }) {
      // A token minted under old credentials no longer counts as signed in.
      if (token.cf !== credentialsFingerprint()) {
        return { ...session, user: undefined, expires: new Date(0).toISOString() };
      }
      return session;
    },
  },
});

/** The signed-in admin's session, or null (stale-credential sessions included). */
export async function adminSession() {
  const session = await auth();
  return session?.user ? session : null;
}
