/**
 * Switchboard's HTTP server: Next.js behind a thin Node wrapper whose only
 * job is to record the real client address for rate limiting.
 *
 * Next.js only fills `X-Forwarded-For` from the socket when the client did
 * not send one, so route handlers cannot tell a forged header from a real
 * one. This wrapper sees the socket, resolves the client address with
 * `TRUSTED_PROXY_HOPS` (see client-ip.mjs), and passes it on in a header it
 * strips from incoming requests first.
 *
 *   node server.mjs          production (after `next build`)
 *   node server.mjs --dev    development with hot reload
 */
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { CLIENT_IP_HEADER, resolveClientIp, trustedProxyHops } from "./client-ip.mjs";
import { enforceConfig } from "./config-check.mjs";

const dev = process.argv.includes("--dev");
const dir = path.dirname(fileURLToPath(import.meta.url));
// Load .env files the way Next would (apps/web/.env*), plus the repo-root
// .env that docker compose and the CLI scripts also read. Real environment
// variables always win; files never override them.
nextEnv.loadEnvConfig(dir, dev);
const rootEnv = path.resolve(dir, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
// Next reads NODE_ENV when it loads, so set it before importing.
process.env.NODE_ENV ??= dev ? "development" : "production";

// Refuse to start on a broken or unsafe production config, before Next
// loads (Next only logs instrumentation errors and keeps serving).
try {
  enforceConfig();
} catch (error) {
  console.error(`[switchboard] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const { default: next } = await import("next");
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const hops = trustedProxyHops();

// Next (and Auth.js on top of it) builds internal URLs from the hostname it
// is given — including the sign-in flow's request to its own auth endpoint.
// A bind-all address (0.0.0.0 / ::) is a listen instruction, not a callable
// address: handing it to Next makes sign-in call http://0.0.0.0:<port> and
// hang forever. Keep binding to it, but tell Next "localhost" instead.
const appHostname =
  hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;

const app = next({ dev, dir, hostname: appHostname, port });
const handle = app.getRequestHandler();
await app.prepare();

createServer((req, res) => {
  delete req.headers[CLIENT_IP_HEADER];
  req.headers[CLIENT_IP_HEADER] = resolveClientIp(
    req.socket.remoteAddress,
    req.headers["x-forwarded-for"],
    hops,
  );
  handle(req, res);
}).listen(port, hostname, () => {
  console.log(
    `[switchboard] listening on http://${hostname}:${port} (${dev ? "dev" : "production"}, trusting ${hops} proxy hop${hops === 1 ? "" : "s"})`,
  );
});
