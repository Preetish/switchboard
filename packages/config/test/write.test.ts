import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadConfig, loadConfigObject, serializeConfig, toConfigObject } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readFile = (file: string) => readFileSync(file, "utf8");

const YAML = `
org: { name: Acme, slug: acme }
theme: { accent: "#0b5fff" }
hubspot:
  properties: { utm_source: utm_source }
reps:
  - { email: Ana@Acme.com, name: Ana, timezone: Europe/Paris, workingHours: { days: [fri, mon], hours: "08:30-16:00" } }
  - { email: ben@acme.com, name: Ben }
teams:
  - key: sales
    members: [ana@acme.com, { rep: ben@acme.com, weight: 3, active: false }]
forms:
  - slug: demo
    name: Demo
    submitLabel: Book
    customCss: ".sb-title { font-weight: 600 }"
    fields:
      - { key: email, label: Email, type: email, required: true }
      - { key: country, label: Country, type: select, required: true, options: [DE, US] }
    rules:
      rules:
        - { name: Germany, when: { form.country: DE }, route: { team: sales, strategy: round_robin } }
      fallback: { action: fallback_queue }
  - slug: contact
    name: Contact
    fields: [{ key: email, label: Email, type: email, required: true }]
`;

describe("loadConfigObject", () => {
  it("builds the same plan as the equivalent YAML", () => {
    const fromYaml = loadConfig(YAML, "/cfg/switchboard.yaml", readFile);
    if (!fromYaml.ok) throw new Error(fromYaml.errors.join("\n"));
    // As the builder would send it: plain JSON.
    const fromObject = loadConfigObject(JSON.parse(JSON.stringify(parse(YAML))));
    expect(fromObject).toEqual(fromYaml);
  });

  it("reports invalid input with where it is", () => {
    const result = loadConfigObject({
      org: { name: "Acme", slug: "Not A Slug" },
      reps: [{ email: "not-an-email", name: "Ana" }],
      forms: [],
    });
    if (result.ok) throw new Error("expected errors");
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^org\.slug: /),
        expect.stringMatching(/^reps\[0\]\.email: must be an email address/),
        expect.stringMatching(/^forms: add at least one form/),
      ]),
    );
    expect(loadConfigObject(null).ok).toBe(false);
  });

  it("rejects a rules file path: rules must be inline from the builder", () => {
    const config = parse(YAML);
    config.forms[0].rules = "rules/demo.yaml";
    const result = loadConfigObject(config);
    if (result.ok) throw new Error("expected errors");
    expect(result.errors).toEqual([
      expect.stringMatching(/^forms\[0\] \(demo\) rules \(rules\/demo\.yaml\): rules must be inline when saving from the builder/),
    ]);
  });
});

describe("serializeConfig", () => {
  it("round-trips the demo config", () => {
    const file = path.join(repoRoot, "examples/switchboard.demo.yaml");
    const first = loadConfig(readFile(file), file, readFile);
    if (!first.ok) throw new Error(first.errors.join("\n"));
    const text = serializeConfig(first.plan);
    const second = loadConfig(text, "/exported/switchboard.yaml", () => {
      throw new Error("an exported config should not read rule files");
    });
    if (!second.ok) throw new Error(second.errors.join("\n"));
    expect(second.plan).toEqual(first.plan);
  });

  it("writes YAML a person would: day names, HH:MM hours, shorthand members, inline rules", () => {
    const loaded = loadConfig(YAML, "/cfg/switchboard.yaml", readFile);
    if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
    const text = serializeConfig(loaded.plan);
    const written = parse(text);
    expect(written.theme).toEqual({ accent: "#0B5FFF" });
    expect(written.hubspot).toEqual({ properties: { utm_source: "utm_source" } });
    expect(written.reps[0].workingHours).toEqual({ days: ["mon", "fri"], hours: "08:30-16:00" });
    expect(written.reps[1].workingHours).toBeUndefined();
    expect(written.teams[0].members).toEqual([
      "ana@acme.com",
      { rep: "ben@acme.com", weight: 3, weeklyCapacity: 0, active: false },
    ]);
    expect(written.forms[0]).toMatchObject({ submitLabel: "Book", customCss: ".sb-title { font-weight: 600 }" });
    expect(written.forms[0].rules.rules[0].name).toBe("Germany");
    expect(written.forms[1].rules).toBeUndefined();
    const again = loadConfigObject(written);
    expect(again.ok && again.plan).toEqual(loaded.plan);
  });
});

describe("toConfigObject", () => {
  it("is what serializeConfig writes, and loads back to the same plan as JSON", () => {
    const loaded = loadConfig(YAML, "/cfg/switchboard.yaml", readFile);
    if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
    const config = toConfigObject(loaded.plan);
    expect(config).toEqual(parse(serializeConfig(loaded.plan)));
    // As the builder sends it back after editing nothing.
    const again = loadConfigObject(JSON.parse(JSON.stringify(config)));
    expect(again.ok && again.plan).toEqual(loaded.plan);
  });
});
