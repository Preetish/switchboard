import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyAdminCredentials } from "./admin-credentials";
import { checkRateLimit, clientIp } from "./rate-limit";

/**
 * Admin auth (roadmap task 13): a single-environment-configured admin
 * account with a JWT session cookie. Replaces the interim
 * `ADMIN_SETUP_KEY` guard on the admin pages and OAuth handshakes (the key
 * survives only on the CSV export route, for scripted exports).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Self-hosters run behind proxies and on non-localhost hosts.
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      name: "Admin",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        // Brute-force guard: once the window is exhausted, attempts are
        // rejected before the password is ever compared; the login page
        // shows the same "invalid" message either way.
        const ip = request ? clientIp(request) : "unknown";
        if (!checkRateLimit("login", ip).allowed) return null;
        return verifyAdminCredentials(credentials?.email, credentials?.password);
      },
    }),
  ],
});
