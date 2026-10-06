import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleApiError, fetchFreeBusy } from "../src/index.js";

const busyPayload = {
  calendars: {
    primary: {
      busy: [
        { start: "2026-10-06T13:00:00Z", end: "2026-10-06T14:00:00Z" },
        { start: "2026-10-07T09:30:00Z", end: "2026-10-07T10:00:00Z" },
      ],
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchFreeBusy", () => {
  it("returns parsed busy intervals for the primary calendar", async () => {
    const stub = vi.fn(async () => new Response(JSON.stringify(busyPayload), { status: 200 }));
    vi.stubGlobal("fetch", stub);

    const result = await fetchFreeBusy({
      accessToken: "at-1",
      timeMin: new Date("2026-10-06T00:00:00Z"),
      timeMax: new Date("2026-10-13T00:00:00Z"),
    });
    expect(result.calendarId).toBe("primary");
    expect(result.busy).toEqual([
      { start: new Date("2026-10-06T13:00:00Z"), end: new Date("2026-10-06T14:00:00Z") },
      { start: new Date("2026-10-07T09:30:00Z"), end: new Date("2026-10-07T10:00:00Z") },
    ]);

    const [input, init] = stub.mock.calls[0]!;
    expect(input).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(init.headers.authorization).toBe("Bearer at-1");
    const body = JSON.parse(init.body);
    expect(body.timeMin).toBe("2026-10-06T00:00:00.000Z");
    expect(body.timeMax).toBe("2026-10-13T00:00:00.000Z");
    expect(body.items).toEqual([{ id: "primary" }]);
  });

  it("honors a custom calendar id", async () => {
    const stub = vi.fn(async () =>
        new Response(JSON.stringify({ calendars: { "work@x.com": { busy: [] } } }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", stub);
    const result = await fetchFreeBusy({
      accessToken: "at-1",
      timeMin: new Date("2026-10-06T00:00:00Z"),
      timeMax: new Date("2026-10-13T00:00:00Z"),
      calendarId: "work@x.com",
    });
    expect(result.busy).toEqual([]);
    expect(JSON.parse(stub.mock.calls[0]![1].body).items).toEqual([{ id: "work@x.com" }]);
  });

  it("raises GoogleApiError on HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "Invalid Credentials" } }), {
          status: 401,
        }),
      ),
    );
    await expect(
      fetchFreeBusy({
        accessToken: "expired",
        timeMin: new Date(),
        timeMax: new Date(),
      }),
    ).rejects.toThrow(GoogleApiError);
  });

  it("raises GoogleApiError on per-calendar errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ calendars: { primary: { errors: [{ reason: "notFound" }] } } }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      fetchFreeBusy({ accessToken: "at", timeMin: new Date(), timeMax: new Date() }),
    ).rejects.toThrow(/notFound/);
  });

  it("raises GoogleApiError on timeout instead of hanging", async () => {
    const stub = vi.fn(
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), {
            once: true,
          });
        }),
    );
    vi.stubGlobal("fetch", stub);
    await expect(
      fetchFreeBusy({
        accessToken: "at",
        timeMin: new Date(),
        timeMax: new Date(),
        timeoutMs: 10,
      }),
    ).rejects.toThrow(GoogleApiError);
    expect(stub).toHaveBeenCalledOnce();
  });
});
