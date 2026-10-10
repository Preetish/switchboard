import { describe, expect, it } from "vitest";
import { parseBookingInput } from "../src/lib/bookings.js";

const UUID = "11111111-1111-1111-1111-111111111111";

function validBody() {
  return {
    userId: UUID,
    startAt: "2026-10-07T13:00:00.000Z",
    durationMinutes: 30,
  };
}

describe("parseBookingInput", () => {
  it("accepts a valid body", () => {
    const parsed = parseBookingInput(validBody());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.userId).toBe(UUID);
      expect(parsed.input.startAt.toISOString()).toBe("2026-10-07T13:00:00.000Z");
      expect(parsed.input.durationMinutes).toBe(30);
      expect(parsed.input.submissionId).toBeNull();
      expect(parsed.input.idempotencyKey).toBeNull();
    }
  });

  it("rejects a non-object body", () => {
    expect(parseBookingInput(null)).toEqual({ ok: false, error: "Expected a JSON body." });
  });

  it("rejects a non-UUID userId", () => {
    expect(parseBookingInput({ ...validBody(), userId: "not-a-uuid" }).ok).toBe(false);
  });

  it("rejects an unparseable startAt", () => {
    expect(parseBookingInput({ ...validBody(), startAt: "tomorrow" }).ok).toBe(false);
    expect(parseBookingInput({ ...validBody(), startAt: 123 }).ok).toBe(false);
  });

  it("rejects durations outside 15–240 and non-integers", () => {
    expect(
      parseBookingInput({ ...validBody(), durationMinutes: 10 }).ok,
    ).toBe(false);
    expect(
      parseBookingInput({ ...validBody(), durationMinutes: 300 }).ok,
    ).toBe(false);
    expect(
      parseBookingInput({ ...validBody(), durationMinutes: 29.5 }).ok,
    ).toBe(false);
  });

  it("rejects a malformed submissionId or idempotencyKey", () => {
    expect(
      parseBookingInput({ ...validBody(), submissionId: "nope" }).ok,
    ).toBe(false);
    expect(
      parseBookingInput({ ...validBody(), idempotencyKey: "x".repeat(129) }).ok,
    ).toBe(false);
  });

  it("accepts explicit nulls for optional fields", () => {
    const parsed = parseBookingInput({ ...validBody(), submissionId: null, idempotencyKey: null });
    expect(parsed.ok).toBe(true);
  });
});
