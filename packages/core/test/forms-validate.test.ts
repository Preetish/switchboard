import { describe, expect, it } from "vitest";
import {
  emailFieldKey,
  validateFormFields,
  validateSubmission,
} from "../src/forms/validate.js";
import type { FormField } from "../src/forms/types.js";

const fields: FormField[] = [
  { key: "name", label: "Name", type: "text", required: true },
  { key: "email", label: "Work email", type: "email", required: true },
  {
    key: "company_size",
    label: "Company size",
    type: "number",
    required: true,
  },
  {
    key: "country",
    label: "Country",
    type: "select",
    required: true,
    options: ["US", "CA", "DE"],
  },
  { key: "message", label: "Message", type: "textarea", required: false },
  {
    key: "consent",
    label: "I agree to be contacted.",
    type: "consent",
    required: true,
  },
];

describe("validateFormFields", () => {
  it("accepts a valid definition", () => {
    const result = validateFormFields(fields);
    expect(result.ok).toBe(true);
  });

  it("rejects duplicate keys", () => {
    const result = validateFormFields([
      { key: "name", label: "A", type: "text", required: false },
      { key: "name", label: "B", type: "text", required: false },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("duplicate field key");
  });

  it("rejects select fields without options", () => {
    const result = validateFormFields([
      { key: "country", label: "Country", type: "select", required: true },
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects options on non-select fields", () => {
    const result = validateFormFields([
      { key: "name", label: "Name", type: "text", required: false, options: ["x"] },
    ]);
    expect(result.ok).toBe(false);
  });

  it("requires consent fields to be required", () => {
    const result = validateFormFields([
      { key: "consent", label: "I agree", type: "consent", required: false },
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects keys that would break rule paths", () => {
    const result = validateFormFields([
      { key: "bad key!", label: "X", type: "text", required: false },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("validateSubmission", () => {
  const payload = {
    name: " Jane Doe ",
    email: "Jane@Corp.COM",
    company_size: "500",
    country: "DE",
    message: " Hello ",
    consent: true,
  };

  it("cleans and normalizes a valid payload", () => {
    const result = validateSubmission(fields, payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        name: "Jane Doe",
        email: "jane@corp.com",
        company_size: "500",
        country: "DE",
        message: "Hello",
        consent: "true",
      });
    }
  });

  it("flags every missing required field", () => {
    const result = validateSubmission(fields, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        "company_size",
        "consent",
        "country",
        "email",
        "name",
      ]);
    }
  });

  it("skips empty optional fields", () => {
    const result = validateSubmission(fields, { ...payload, message: "  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.message).toBeUndefined();
  });

  it("rejects malformed emails", () => {
    const result = validateSubmission(fields, { ...payload, email: "not-an-email" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.email).toBeDefined();
  });

  it("rejects non-numeric company sizes", () => {
    const result = validateSubmission(fields, { ...payload, company_size: "big" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.company_size).toBeDefined();
  });

  it("rejects select values outside the options", () => {
    const result = validateSubmission(fields, { ...payload, country: "FR" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.country).toBeDefined();
  });

  it("rejects unticked consent", () => {
    const result = validateSubmission(fields, { ...payload, consent: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.consent).toBeDefined();
  });

  it("rejects unknown fields instead of silently dropping them", () => {
    const result = validateSubmission(fields, { ...payload, admin: "1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["_form.admin"]).toBeDefined();
  });

  it("rejects non-object payloads", () => {
    expect(validateSubmission(fields, "x").ok).toBe(false);
    expect(validateSubmission(fields, null).ok).toBe(false);
    expect(validateSubmission(fields, [1]).ok).toBe(false);
  });
});

describe("emailFieldKey", () => {
  it("finds the first email field", () => {
    expect(emailFieldKey(fields)).toBe("email");
    expect(emailFieldKey(fields.filter((f) => f.type !== "email"))).toBeUndefined();
  });
});
