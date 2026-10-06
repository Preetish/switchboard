import { describe, expect, it } from "vitest";
import { draftOutcome } from "../src/rules/outcome.js";
import type { RouteAction } from "../src/rules/types.js";

const inputs = {
  form: { email: "jane@corp.com" },
  crm: { contact: { owner: "owner-123" } },
};

describe("draftOutcome", () => {
  it("resolves a `to` path from the prefetched inputs", () => {
    const action: RouteAction = { to: "crm.contact.owner" };
    expect(draftOutcome(action, inputs)).toEqual({
      kind: "route_user",
      to: "owner-123",
      toSource: "crm.contact.owner",
      reason: "Matched target crm.contact.owner.",
    });
  });

  it("carries the raw target when the path is missing", () => {
    const action: RouteAction = { to: "crm.contact.owner" };
    const draft = draftOutcome(action, { form: {}, crm: {} });
    expect(draft.kind).toBe("route_user");
    expect(draft.to).toBe("crm.contact.owner");
    expect(draft.reason).toContain("not available");
  });

  it("treats a literal target as-is", () => {
    const draft = draftOutcome({ to: "alice@acme.test" }, inputs);
    expect(draft.kind).toBe("route_user");
    expect(draft.to).toBe("alice@acme.test");
  });

  it("carries team key and strategy", () => {
    const draft = draftOutcome({ team: "enterprise", strategy: "round_robin" }, inputs);
    expect(draft).toMatchObject({
      kind: "route_team",
      teamKey: "enterprise",
      strategy: "round_robin",
    });
  });

  it("maps self_serve_link and fallback_queue", () => {
    expect(draftOutcome({ action: "self_serve_link" }, inputs).kind).toBe(
      "self_serve_link",
    );
    expect(draftOutcome({ action: "fallback_queue" }, inputs).kind).toBe(
      "fallback_queue",
    );
  });
});
