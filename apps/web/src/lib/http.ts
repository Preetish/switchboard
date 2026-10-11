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
