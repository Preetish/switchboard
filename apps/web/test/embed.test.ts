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
  it("ships a minified artifact under 10 KB", () => {
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
    expect(source).toContain('data.type !== "switchboard:resize"');
  });

  it("refuses to mount when the deployment origin is unknown", () => {
    // An empty base would silently point the iframe at the host's origin.
    expect(source).toContain('console.warn("[switchboard] embed.js must be loaded via <script src=...>")');
  });

  it("never injects HTML or evaluates remote code", () => {
    expect(artifact).not.toMatch(/\beval\(|document\.write|innerHTML/);
  });
});

/**
 * Behavioral checks: run the real loader against a minimal fake DOM, so the
 * mount, late-mount, and resize-validation paths are exercised rather than
 * string-matched.
 */
describe("embed loader behavior", () => {
  type Node = { attrs: Record<string, string>; children: unknown[]; __sbEmbed?: boolean };

  function load() {
    const listeners: Record<string, Array<(event: unknown) => void>> = {};
    const placeholders: Node[] = [];
    let observer: (() => void) | null = null;
    const created: Array<{ src: string; style: { cssText: string; height?: string }; contentWindow: object }> = [];
    const window: Record<string, unknown> = {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        (listeners[type] ??= []).push(fn);
      },
      MutationObserver: class {
        constructor(fn: () => void) {
          observer = fn;
        }
        observe() {}
      },
    };
    const document = {
      readyState: "complete",
      currentScript: { src: "https://sb.example.com/embed.js" },
      body: {},
      querySelector: () => null,
      querySelectorAll: () => placeholders,
      createElement: () => {
        const iframe = { src: "", title: "", style: { cssText: "" } as { cssText: string; height?: string }, contentWindow: {} };
        created.push(iframe);
        return iframe;
      },
    };
    const run = new Function(
      "window",
      "document",
      "location",
      "requestAnimationFrame",
      "console",
      source,
    );
    run(window, document, { href: "https://host.example/" }, (fn: () => void) => fn(), console);
    const add = (slug: string) => {
      const node: Node & { getAttribute: (k: string) => string | null; appendChild: (c: unknown) => void } = {
        attrs: { "data-switchboard-form": slug },
        children: [],
        getAttribute(key) {
          return this.attrs[key] ?? null;
        },
        appendChild(child) {
          this.children.push(child);
        },
      };
      placeholders.push(node);
      return node;
    };
    const message = (event: unknown) => listeners.message?.forEach((fn) => fn(event));
    return { window, add, created, message, mutate: () => observer?.() };
  }

  it("mounts placeholders present at load and ones added later", () => {
    const env = load();
    env.add("book-a-demo");
    (env.window.Switchboard as { mount: () => void }).mount();
    expect(env.created.map((f) => f.src)).toEqual(["https://sb.example.com/f/book-a-demo?embed=1"]);
    env.add("pricing");
    env.mutate();
    expect(env.created).toHaveLength(2);
    env.mutate();
    expect(env.created).toHaveLength(2); // never mounts twice
  });

  it("resizes only for messages from its own iframe and origin", () => {
    const env = load();
    env.add("book-a-demo");
    (env.window.Switchboard as { mount: () => void }).mount();
    const iframe = env.created[0]!;
    const resize = { type: "switchboard:resize", height: 812.4 };
    env.message({ origin: "https://evil.example", source: iframe.contentWindow, data: resize });
    expect(iframe.style.height).toBeUndefined();
    env.message({ origin: "https://sb.example.com", source: {}, data: resize });
    expect(iframe.style.height).toBeUndefined();
    env.message({ origin: "https://sb.example.com", source: iframe.contentWindow, data: { ...resize, height: 99999 } });
    expect(iframe.style.height).toBeUndefined();
    env.message({ origin: "https://sb.example.com", source: iframe.contentWindow, data: resize });
    expect(iframe.style.height).toBe("812px");
  });
});
