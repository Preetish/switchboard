import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ALERT_MINUTES,
  buildSpeedToLeadAlert,
  decideSpeedToLeadAlert,
  leadDisplay,
  sendSlackAlert,
  alertWindowMinutes,
} from "../src/lib/alerts.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("alertWindowMinutes", () => {
  it("defaults to 5 when SPEED_TO_LEAD_MINUTES is unset", () => {
    expect(alertWindowMinutes()).toBe(DEFAULT_ALERT_MINUTES);
  });

  it("parses a valid value", () => {
    vi.stubEnv("SPEED_TO_LEAD_MINUTES", "10");
    expect(alertWindowMinutes()).toBe(10);
  });

  it("falls back to the default for garbage, zero, and negative values", () => {
    for (const bad of ["abc", "0", "-3", ""]) {
      vi.stubEnv("SPEED_TO_LEAD_MINUTES", bad);
      expect(alertWindowMinutes()).toBe(DEFAULT_ALERT_MINUTES);
    }
  });

  it("floors fractional values to whole minutes", () => {
    vi.stubEnv("SPEED_TO_LEAD_MINUTES", "2.9");
    expect(alertWindowMinutes()).toBe(2);
  });
});

describe("decideSpeedToLeadAlert", () => {
  it("sends when the lead is unbooked and not yet alerted", () => {
    expect(decideSpeedToLeadAlert({ hasActiveBooking: false, alreadyAlerted: false })).toBe(
      "send",
    );
  });

  it("skips when the lead booked within the window", () => {
    expect(decideSpeedToLeadAlert({ hasActiveBooking: true, alreadyAlerted: false })).toBe(
      "skip_booked",
    );
  });

  it("skips when the alert already went out", () => {
    expect(decideSpeedToLeadAlert({ hasActiveBooking: false, alreadyAlerted: true })).toBe(
      "skip_already_alerted",
    );
  });

  it("reports booked-in-time over already-alerted (never a duplicate send)", () => {
    expect(decideSpeedToLeadAlert({ hasActiveBooking: true, alreadyAlerted: true })).toBe(
      "skip_booked",
    );
  });
});

describe("buildSpeedToLeadAlert", () => {
  const base = {
    repName: "Alice Chen",
    leadEmail: "dana@bigcorp.com",
    formName: "Book a demo",
    waitedMinutes: 5,
    submissionId: "11111111-1111-1111-1111-111111111111",
  };

  it("names the lead, form, wait, and reference", () => {
    const { text, slackText } = buildSpeedToLeadAlert({ ...base, leadName: "Dana" });
    expect(text).toContain("Hi Alice Chen");
    expect(text).toContain("Dana (dana@bigcorp.com)");
    expect(text).toContain('via "Book a demo"');
    expect(text).toContain("5 minute(s) ago");
    expect(text).toContain(base.submissionId);
    expect(slackText).toContain("Speed-to-lead");
    expect(slackText).toContain(base.submissionId);
  });

  it("falls back to the email when the lead has no name", () => {
    const { text } = buildSpeedToLeadAlert({ ...base, leadName: null });
    expect(text).toContain("dana@bigcorp.com submitted");
  });

  it("copes with a lead that has neither name nor email", () => {
    const { subject } = buildSpeedToLeadAlert({ ...base, leadName: null, leadEmail: null });
    expect(subject).toContain("An unnamed lead");
  });

  it("drops the form clause when the form name is unknown", () => {
    const { text } = buildSpeedToLeadAlert({ ...base, leadName: "Dana", formName: null });
    expect(text).toContain("Dana (dana@bigcorp.com) submitted 5 minute(s) ago");
    expect(text).not.toContain("via");
  });
});

describe("leadDisplay", () => {
  it("prefers name with email, then whichever exists", () => {
    expect(leadDisplay("Dana", "dana@x.test")).toBe("Dana (dana@x.test)");
    expect(leadDisplay(null, "dana@x.test")).toBe("dana@x.test");
    expect(leadDisplay("Dana", null)).toBe("Dana");
    expect(leadDisplay(null, null)).toBe("An unnamed lead");
  });
});

describe("sendSlackAlert", () => {
  it("posts the text as JSON and reports success", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const sent = await sendSlackAlert("https://hooks.slack.com/services/T/B/x", "hello");
    expect(sent).toBe(true);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://hooks.slack.com/services/T/B/x");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ text: "hello" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports failure on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendSlackAlert("https://hooks.slack.com/x", "hello")).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("500"));
  });

  it("reports failure instead of throwing when the webhook is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendSlackAlert("https://hooks.slack.com/x", "hello")).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("ENOTFOUND"));
  });
});
