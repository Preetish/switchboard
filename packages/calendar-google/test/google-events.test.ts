import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleEventError, createCalendarEvent } from "../src/index.js";

const createdPayload = {
  id: "evt_1",
  hangoutLink: "https://meet.google.com/abc-defg-hij",
  htmlLink: "https://calendar.google.com/event?eid=evt_1",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function successStub() {
  return vi.fn(async () => new Response(JSON.stringify(createdPayload), { status: 200 }));
}

describe("createCalendarEvent", () => {
  it("posts the event with a Meet conference request and attendees", async () => {
    const stub = successStub();
    vi.stubGlobal("fetch", stub);

    const result = await createCalendarEvent({
      accessToken: "at-1",
      summary: "Acme — Jane Doe",
      start: new Date("2026-10-07T13:00:00Z"),
      end: new Date("2026-10-07T13:30:00Z"),
      attendeeEmails: ["jane@corp.com", "alice@acme.test"],
      description: "Demo call",
    });
    expect(result).toEqual({
      eventId: "evt_1",
      meetLink: "https://meet.google.com/abc-defg-hij",
      htmlLink: "https://calendar.google.com/event?eid=evt_1",
    });

    const [input, init] = stub.mock.calls[0]!;
    expect(input).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    );
    expect(init.headers.authorization).toBe("Bearer at-1");
    const body = JSON.parse(init.body);
    expect(body.summary).toBe("Acme — Jane Doe");
    expect(body.description).toBe("Demo call");
    expect(body.start).toEqual({ dateTime: "2026-10-07T13:00:00.000Z", timeZone: "UTC" });
    expect(body.end).toEqual({ dateTime: "2026-10-07T13:30:00.000Z", timeZone: "UTC" });
    expect(body.attendees).toEqual([
      { email: "jane@corp.com" },
      { email: "alice@acme.test" },
    ]);
    expect(body.conferenceData.createRequest.conferenceSolutionKey).toEqual({
      type: "hangoutsMeet",
    });
    expect(typeof body.conferenceData.createRequest.requestId).toBe("string");
  });

  it("honors a custom calendar id", async () => {
    const stub = successStub();
    vi.stubGlobal("fetch", stub);
    await createCalendarEvent({
      accessToken: "at-1",
      summary: "s",
      start: new Date(),
      end: new Date(),
      attendeeEmails: [],
      calendarId: "work@x.com",
    });
    expect(stub.mock.calls[0]![0]).toContain(
      "https://www.googleapis.com/calendar/v3/calendars/work%40x.com/events",
    );
  });

  it("returns a null Meet link when Google creates no conference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "evt_2" }), { status: 200 })),
    );
    const result = await createCalendarEvent({
      accessToken: "at-1",
      summary: "s",
      start: new Date(),
      end: new Date(),
      attendeeEmails: [],
    });
    expect(result.meetLink).toBeNull();
    expect(result.eventId).toBe("evt_2");
  });

  it("raises GoogleEventError on HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "Invalid Credentials" } }), {
          status: 401,
        }),
      ),
    );
    await expect(
      createCalendarEvent({
        accessToken: "expired",
        summary: "s",
        start: new Date(),
        end: new Date(),
        attendeeEmails: [],
      }),
    ).rejects.toThrow(GoogleEventError);
  });

  it("raises GoogleEventError on timeout instead of hanging", async () => {
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
      createCalendarEvent({
        accessToken: "at",
        summary: "s",
        start: new Date(),
        end: new Date(),
        attendeeEmails: [],
        timeoutMs: 10,
      }),
    ).rejects.toThrow(GoogleEventError);
    expect(stub).toHaveBeenCalledOnce();
  });
});
