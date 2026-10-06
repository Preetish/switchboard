import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConfirmationEmail, sendConfirmationEmail } from "../src/lib/email.js";

const base = {
  to: "jane@corp.com",
  leadName: "Jane",
  orgName: "Acme Inc",
  repName: "Alice Chen",
  repEmail: "alice@acme.test",
  startAt: new Date("2026-10-07T13:00:00Z"),
  repTimeZone: "America/New_York",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("buildConfirmationEmail", () => {
  it("formats the meeting in the rep's time zone and includes the Meet link", () => {
    const { subject, text } = buildConfirmationEmail({ ...base, meetLink: "https://meet.google.com/x", fallbackUrl: null });
    expect(subject).toContain("meeting with Alice Chen");
    // 13:00Z in October EDT is 09:00 local.
    expect(text).toContain("9:00");
    expect(text).toContain("Eastern Daylight Time");
    expect(text).toContain("https://meet.google.com/x");
    expect(text).toContain("alice@acme.test");
    expect(text).not.toContain("booking link");
  });

  it("greets the lead by name when known", () => {
    const { text } = buildConfirmationEmail({ ...base, meetLink: null, fallbackUrl: null });
    expect(text.startsWith("Hi Jane,")).toBe(true);
  });

  it("offers the plain booking link when the calendar event failed", () => {
    const { text } = buildConfirmationEmail({
      ...base,
      meetLink: null,
      fallbackUrl: "https://cal.example.com/alice",
    });
    expect(text).toContain("could not create the calendar event");
    expect(text).toContain("https://cal.example.com/alice");
  });

  it("still explains the failure when there is no fallback link", () => {
    const { text } = buildConfirmationEmail({ ...base, meetLink: null, fallbackUrl: null });
    expect(text).toContain("could not create the calendar event");
    expect(text).toContain("reply to this email");
  });
});

describe("sendConfirmationEmail", () => {
  it("skips without SMTP_URL and reports it honestly", async () => {
    vi.stubEnv("SMTP_URL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sent = await sendConfirmationEmail({ ...base, meetLink: null, fallbackUrl: null });
    expect(sent).toBe(false);
    expect(warn).toHaveBeenCalledWith("SMTP_URL is not set — confirmation email skipped.");
  });

  it("sends the built message over SMTP", async () => {
    vi.stubEnv("SMTP_URL", "smtp://localhost:2525");
    const sendMail = vi.fn(async (_message: unknown) => undefined);
    vi.doMock("nodemailer", () => ({
      createTransport: vi.fn(() => ({ sendMail })),
    }));
    const { sendConfirmationEmail: send } = await import("../src/lib/email.js");
    const sent = await send({ ...base, meetLink: "https://meet.google.com/x", fallbackUrl: null });
    expect(sent).toBe(true);
    expect(sendMail).toHaveBeenCalledOnce();
    const mail = sendMail.mock.calls[0]?.[0] as Record<string, string> | undefined;
    expect(mail?.to).toBe("jane@corp.com");
    expect(mail?.subject).toContain("Alice Chen");
    expect(mail?.text).toContain("https://meet.google.com/x");
  });

  it("returns false and logs when SMTP fails", async () => {
    vi.stubEnv("SMTP_URL", "smtp://localhost:2525");
    vi.doMock("nodemailer", () => ({
      createTransport: vi.fn(() => ({
        sendMail: vi.fn(async () => {
          throw new Error("connection refused");
        }),
      })),
    }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendConfirmationEmail: send } = await import("../src/lib/email.js");
    const sent = await send({ ...base, meetLink: null, fallbackUrl: null });
    expect(sent).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("connection refused"));
  });
});
