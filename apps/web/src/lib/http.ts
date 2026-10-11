/** Small request helpers shared by the route handlers. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Largest JSON body the public endpoints accept. */
export const MAX_JSON_BYTES = 64 * 1024;

/**
 * Parse a JSON request body, refusing anything larger than `maxBytes`
 * before it is buffered in full. Returns `undefined` for a missing,
 * oversized, or malformed body.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_JSON_BYTES,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return undefined;
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * CORS for the public lead endpoints (submit, availability, booking, data
 * deletion), so customers can build their own form on their own site (see
 * docs/custom-form.md). These endpoints use no cookies, so allowing
 * cross-origin calls exposes nothing a direct request couldn't. The same
 * EMBED_ALLOWED_ORIGINS list that limits who can frame forms limits who can
 * call these; unset means any site.
 */
function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  const list = process.env.EMBED_ALLOWED_ORIGINS?.trim();
  if (!list) return "*";
  if (!origin) return null;
  return list.split(/\s+/).includes(origin) ? origin : null;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    ...(origin === "*" ? {} : { Vary: "Origin" }),
  };
}

/** The preflight answer for a public endpoint. */
export function corsPreflight(request: Request): Response {
  const origin = allowedOrigin(request);
  return new Response(null, { status: 204, headers: origin ? corsHeaders(origin) : {} });
}

/** Wrap a public endpoint's handler so its responses carry CORS headers. */
export function withCors<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    const response = await handler(request, ...args);
    const origin = allowedOrigin(request);
    if (origin) {
      for (const [key, value] of Object.entries(corsHeaders(origin))) response.headers.set(key, value);
    }
    return response;
  };
}
