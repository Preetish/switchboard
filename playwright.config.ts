import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests of the real lead flow in a browser: the production build
 * against a Postgres with the demo config loaded (CI does both; locally run
 * `npm run build && npm run demo:load` first, with DATABASE_URL set).
 */
const PORT = Number(process.env.E2E_PORT ?? 3300);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  // One worker: tests share reps and slots, and two leads racing for the
  // same slot is (correctly) a 409 — not something a test should hit by chance.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: {
      // The embed tests serve a fake customer site that loads the app from
      // localhost. Chrome's local-network-access check blocks that pairing;
      // real sites load Switchboard from a public HTTPS host and never hit it.
      args: ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults"],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node apps/web/server.mjs",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: "production",
      // Plenty of submissions from one address during a test run.
      TRUSTED_PROXY_HOPS: "1",
    },
  },
});
