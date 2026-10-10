import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HubspotApiError,
  findContactByEmail,
  getOwner,
  logMeeting,
  upsertContact,
} from "../src/index.js";

const token = { accessToken: "at-1" };

const jsonFetch = (status: number, payload: unknown) => {
  const stub = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", stub);
  return stub;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("findContactByEmail", () => {
  it("looks the contact up by the email id property", async () => {
    const stub = jsonFetch(200, {
      id: "501",
      properties: { email: "jane@corp.com", hubspot_owner_id: "77" },
    });
    const contact = await findContactByEmail({ ...token, email: "Jane@Corp.com" });
    expect(contact).toEqual({
      id: "501",
      email: "jane@corp.com",
      ownerId: "77",
    });

    const [url, init] = stub.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/crm/v3/objects/contacts/jane%40corp.com?");
    expect(url).toContain("idProperty=email");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer at-1");
  });

  it("returns null when HubSpot has no contact for the email", async () => {
    jsonFetch(404, { status: "error" });
    const contact = await findContactByEmail({ ...token, email: "nobody@corp.com" });
    expect(contact).toBeNull();
  });

  it("raises HubspotApiError on other failures", async () => {
    jsonFetch(401, { status: "unauthorized" });
    await expect(findContactByEmail({ ...token, email: "x@corp.com" })).rejects.toThrow(
      HubspotApiError,
    );
  });
});

describe("getOwner", () => {
  it("maps the owner to an email for routing", async () => {
    const stub = jsonFetch(200, {
      id: 77,
      email: "alice@acme.test",
      firstName: "Alice",
      lastName: "Chen",
    });
    const owner = await getOwner({ ...token, ownerId: "77" });
    expect(owner).toEqual({ id: "77", email: "alice@acme.test", name: "Alice Chen" });
    const [url] = stub.mock.calls[0]! as [string];
    expect(url).toContain("/crm/v3/objects/owners/77");
  });

  it("tolerates a missing name", async () => {
    jsonFetch(200, { id: 77, email: "alice@acme.test" });
    const owner = await getOwner({ ...token, ownerId: "77" });
    expect(owner?.name).toBeNull();
  });
});

describe("upsertContact", () => {
  it("posts a batch upsert keyed on the email id property", async () => {
    const stub = jsonFetch(200, { results: [{ id: "501" }] });
    const result = await upsertContact({
      ...token,
      email: "jane@corp.com",
      properties: { firstname: "Jane", company_size: "750" },
    });
    expect(result.id).toBe("501");

    const [url, init] = stub.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/crm/v3/objects/contacts/batch/upsert");
    const body = JSON.parse(init.body as string) as {
      inputs: Array<{
        idProperty: string;
        id: string;
        properties: Record<string, string>;
      }>;
    };
    expect(body.inputs).toHaveLength(1);
    expect(body.inputs[0]?.idProperty).toBe("email");
    expect(body.inputs[0]?.id).toBe("jane@corp.com");
    expect(body.inputs[0]?.properties).toMatchObject({
      email: "jane@corp.com",
      firstname: "Jane",
    });
  });

  it("raises HubspotApiError when the response carries no results", async () => {
    jsonFetch(200, {});
    await expect(upsertContact({ ...token, email: "jane@corp.com" })).rejects.toThrow(
      /no id/,
    );
  });

  it("raises HubspotApiError on a conflicting failure", async () => {
    jsonFetch(409, { status: "error" });
    await expect(upsertContact({ ...token, email: "jane@corp.com" })).rejects.toThrow(
      HubspotApiError,
    );
  });
});

describe("logMeeting", () => {
  it("creates a meeting associated to the contact", async () => {
    const stub = jsonFetch(200, { id: "m-1" });
    const result = await logMeeting({
      ...token,
      contactId: "501",
      title: "Demo with Jane",
      startAt: new Date("2026-10-12T13:00:00Z"),
      endAt: new Date("2026-10-12T13:30:00Z"),
      body: "Meet link: https://meet.google.com/abc",
      ownerId: "77",
    });
    expect(result.meetingId).toBe("m-1");

    const [, init] = stub.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      properties: Record<string, string>;
      associations: Array<{
        to: { id: string };
        types: Array<{ associationTypeId: number }>;
      }>;
    };
    expect(body.properties.hs_meeting_title).toBe("Demo with Jane");
    expect(body.properties.hs_timestamp).toBe("2026-10-12T13:00:00.000Z");
    expect(body.properties.hubspot_owner_id).toBe("77");
    expect(body.associations[0]?.to.id).toBe("501");
    expect(body.associations[0]?.types[0]?.associationTypeId).toBe(199);
  });

  it("raises HubspotApiError on failure", async () => {
    jsonFetch(500, { message: "boom" });
    await expect(
      logMeeting({
        ...token,
        contactId: "501",
        title: "t",
        startAt: new Date(),
        endAt: new Date(),
      }),
    ).rejects.toThrow(HubspotApiError);
  });
});

describe("timeouts", () => {
  it("aborts a hanging call after the given timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal.reason ?? new Error("aborted")),
            );
          }),
      ),
    );
    await expect(
      findContactByEmail({ ...token, email: "a@b.co", timeoutMs: 20 }),
    ).rejects.toThrow(HubspotApiError);
    await expect(
      findContactByEmail({ ...token, email: "a@b.co", timeoutMs: 20 }),
    ).rejects.toThrow(/unreachable/);
  });
});
