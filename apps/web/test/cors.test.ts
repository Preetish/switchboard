import { afterEach, describe, expect, it } from "vitest";
import { corsPreflight, withCors } from "@/lib/http";

const request = (origin?: string) =>
  new Request("https://sb.example/api/f/demo/submit", {
    method: "POST",
    headers: origin ? { origin } : {},
  });

afterEach(() => {
  delete process.env.EMBED_ALLOWED_ORIGINS;
});

describe("CORS for public endpoints", () => {
  it("allows any site by default, without credentials", async () => {
    const handler = withCors(async () => Response.json({ ok: true }));
    const response = await handler(request("https://acme.com"));
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    const preflight = corsPreflight(request("https://acme.com"));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("allows only the sites in EMBED_ALLOWED_ORIGINS when it's set", async () => {
    process.env.EMBED_ALLOWED_ORIGINS = "https://acme.com https://www.acme.com";
    const handler = withCors(async () => Response.json({ ok: true }));
    const allowed = await handler(request("https://www.acme.com"));
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://www.acme.com");
    expect(allowed.headers.get("vary")).toBe("Origin");
    const other = await handler(request("https://evil.example"));
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    expect(corsPreflight(request("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });
});
