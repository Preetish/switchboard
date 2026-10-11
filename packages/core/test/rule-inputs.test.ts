import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRuleInputs, evaluate, loadRuleSetYaml, type FormField } from "../src/index.js";

const fields: FormField[] = [
  { key: "name", label: "Full name", type: "text", required: true },
  { key: "email", label: "Work email", type: "email", required: true },
  { key: "company_size", label: "Company size", type: "number", required: true },
  { key: "country", label: "Country", type: "select", required: true, options: ["US", "DE"] },
];

describe("buildRuleInputs", () => {
  it("derives form.email_domain from the form's email field", () => {
    const inputs = buildRuleInputs(fields, { email: "jane@gmail.com" });
    expect(inputs.form.email_domain).toBe("gmail.com");
    expect(inputs.crm).toEqual({});
  });

  it("lets a declared email_domain field win over the derived value", () => {
    const withField: FormField[] = [
      ...fields,
      { key: "email_domain", label: "Domain", type: "text", required: false },
    ];
    const inputs = buildRuleInputs(withField, {
      email: "jane@gmail.com",
      email_domain: "corp.com",
    });
    expect(inputs.form.email_domain).toBe("corp.com");
  });

  it("adds nothing when the form has no email field", () => {
    const inputs = buildRuleInputs([fields[0]!], { name: "Jane" });
    expect(inputs.form).toEqual({ name: "Jane" });
  });

  it("passes CRM context through", () => {
    const crm = { contact: { owner: "alice@acme.test" } };
    expect(buildRuleInputs(fields, {}, crm).crm).toBe(crm);
  });
});

/**
 * The example rule files are what new users copy first, so they are run
 * end to end against realistic submissions — not just validated.
 */
describe("example rule sets route realistic leads", () => {
  const examples = fileURLToPath(new URL("../../../examples", import.meta.url));
  const load = (file: string) => {
    const result = loadRuleSetYaml(readFileSync(`${examples}/${file}`, "utf8"));
    if (!result.ok) throw new Error(result.errors.join("\n"));
    return result.ruleSet;
  };
  const route = (file: string, data: Record<string, string>, crm?: Record<string, unknown>) =>
    evaluate(load(file), buildRuleInputs(fields, data, crm ?? null)).matchedRule;

  it("rules.example.yaml: personal email goes self-serve", () => {
    expect(
      route("rules.example.yaml", { email: "jane@gmail.com", company_size: "20", country: "US" }),
    ).toBe("Personal email goes self-serve");
  });

  it("rules.example.yaml: existing CRM owner wins over everything", () => {
    expect(
      route(
        "rules.example.yaml",
        { email: "jane@gmail.com", company_size: "900", country: "DE" },
        { contact: { owner: "alice@acme.test" } },
      ),
    ).toBe("Existing owner wins");
  });

  it("rules.example.yaml: enterprise by size, DACH by country, else fallback", () => {
    expect(
      route("rules.example.yaml", { email: "a@corp.com", company_size: "900", country: "US" }),
    ).toBe("Enterprise");
    expect(
      route("rules.example.yaml", { email: "a@corp.de", company_size: "40", country: "DE" }),
    ).toBe("DACH region");
    expect(
      route("rules.example.yaml", { email: "a@corp.com", company_size: "40", country: "US" }),
    ).toBeNull();
  });

  it("rules.saas.yaml: free email goes self-serve before enterprise", () => {
    expect(
      route("rules.saas.yaml", { email: "cto@yahoo.com", company_size: "900", country: "US" }),
    ).toBe("Personal email goes self-serve");
  });
});
