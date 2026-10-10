import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const embedRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/embed",
);
const source = readFileSync(path.join(embedRoot, "embed.js"), "utf8");
const artifact = readFileSync(
  path.join(embedRoot, "../../apps/web/public/embed.js"),
  "utf8",
);

describe("embed loader", () => {
  it("ships a minified artifact under 10 KB (the brief's budget)", () => {
    expect(artifact.length).toBeLessThan(10 * 1024);
  });

  it("artifact is the minified source, i.e. in sync with packages/embed", async () => {
    const esbuild = await import("esbuild");
    const result = await esbuild.build({
      entryPoints: [path.join(embedRoot, "embed.js")],
      minify: true,
      target: "es2017",
      write: false,
    });
    expect(result.outputFiles).toHaveLength(1);
    expect(result.outputFiles[0]!.text).toBe(artifact);
  });

  it("mounts forms by data attribute in embed mode", () => {
    expect(source).toContain("data-switchboard-form");
    expect(source).toContain("?embed=1");
  });

  it("validates postMessage origin and source before resizing", () => {
    expect(source).toContain("event.origin !== base");
    expect(source).toContain("event.source !== iframe.contentWindow");
  });

  it("refuses to mount when the deployment origin is unknown", () => {
    // An empty base would silently point the iframe at the host's origin.
    expect(source).toContain('console.warn("[switchboard] embed.js must be loaded via <script src=...>")');
  });

  it("never injects HTML or evaluates remote code", () => {
    expect(artifact).not.toMatch(/\beval\(|document\.write|innerHTML/);
  });
});
