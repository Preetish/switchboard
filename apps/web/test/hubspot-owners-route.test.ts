import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  signedIn: true,
  org: { id: "org-1", name: "Acme" } as { id: string; name: string } | null,
  accessToken: null as string | null,
}));

vi.mock("@/lib/auth", () => ({ adminSession: async () => (state.signedIn ? { user: {} } : null) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/integrations", () => ({ findOrg: async () => state.org }));
vi.mock("@/lib/crm", () => ({
  getValidHubspotAccessToken: async (_db: unknown, orgId: string) =>
    orgId === "org-1" ? state.accessToken : null,
}));

const { GET } = await import("../src/app/api/admin/hubspot/owners/route");

beforeEach(() => {
  state.signedIn = true;
  state.org = { id: "org-1", name: "Acme" };
  state.accessToken = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/admin/hubspot/owners", () => {
  it("requires an admin session", async () => {
    state.signedIn = false;
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns 404 saying HubSpot is not connected when there is no token", async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    const response = await GET();
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/^HubSpot is not connected\./);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no org yet", async () => {
    state.org = null;
    state.accessToken = "at-1";
    const response = await GET();
    expect(response.status).toBe(404);
  });

  it("lists the owners with the stored token", async () => {
    state.accessToken = "at-1";
    const fetchStub = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ results: [{ id: 7, email: "Ana@Acme.test", firstName: "Ana" }, { id: 8 }] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchStub);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "7", email: "Ana@Acme.test", name: "Ana" }]);
    const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer at-1");
  });

  it("returns 502 when HubSpot fails", async () => {
    state.accessToken = "at-1";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET();
    expect(response.status).toBe(502);
  });
});
