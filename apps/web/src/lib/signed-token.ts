import { createHmac } from "node:crypto";
import { secretsMatch } from "./crypto";

/**
 * Compact signed, expiring tokens (HMAC-SHA256 with `AUTH_SECRET`) for links
 * we email out, e.g. the data-deletion confirmation. The payload is readable
 * (base64url JSON), not secret — only tamper-proof.
 */

type Envelope<T> = { p: T; e: number; k: string };

function key(): string | null {
  return process.env.AUTH_SECRET || null;
}

export function signToken<T>(kind: string, payload: T, ttlMs: number, now = Date.now()): string | null {
  const secret = key();
  if (!secret) return null;
  const body = Buffer.from(
    JSON.stringify({ p: payload, e: now + ttlMs, k: kind } satisfies Envelope<T>),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function verifyToken<T>(kind: string, token: unknown, now = Date.now()): T | null {
  const secret = key();
  if (!secret || typeof token !== "string" || token.length > 4096) return null;
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length > 0) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!secretsMatch(signature, expected)) return null;
  try {
    const envelope = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Envelope<T>;
    if (envelope.k !== kind || typeof envelope.e !== "number" || envelope.e < now) return null;
    return envelope.p;
  } catch {
    return null;
  }
}
