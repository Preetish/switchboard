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
 * mount, late-mount, resize, attribution, and conversion paths are exercised
 * rather than string-matched.
 */
describe("embed loader behavior", () => {
  type Frame = {
    src: string;
    title: string;
    style: { cssText: string; height?: string };
    contentWindow: { postMessage: (message: unknown, origin: string) => void; sent: unknown[] };
  };
  type Placeholder = {
    attrs: Record<string, string>;
    children: unknown[];
    events: { type: string; detail: unknown }[];
    getAttribute: (key: string) => string | null;
    appendChild: (child: unknown) => void;
    dispatchEvent: (event: { type: string; detail: unknown }) => boolean;
  };

  function load(
    options: {
      href?: string;
      referrer?: string;
      cookie?: string;
      consent?: boolean;
      storage?: Map<string, string>;
    } = {},
  ) {
    const listeners: Record<string, Array<(event: unknown) => void>> = {};
    const placeholders: Placeholder[] = [];
    let observer: (() => void) | null = null;
    const created: Frame[] = [];
    const storage = options.storage ?? new Map<string, string>();
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
    const href = options.href ?? "https://acme.example/demo";
    const document = {
      readyState: "complete",
      currentScript: {
        src: "https://sb.example.com/embed.js",
        getAttribute: (key: string) =>
          key === "data-switchboard-consent" && options.consent ? "granted" : null,
      },
      referrer: options.referrer ?? "",
      cookie: options.cookie ?? "",
      body: {},
      querySelector: () => null,
      querySelectorAll: () => placeholders,
      createElement: () => {
        const sent: unknown[] = [];
        const frame: Frame = {
          src: "",
          title: "",
          style: { cssText: "" },
          contentWindow: { sent, postMessage: (message) => void sent.push(message) },
        };
        created.push(frame);
        return frame;
      },
    };
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    };
    class FakeCustomEvent {
      constructor(
        public type: string,
        init: { detail: unknown },
      ) {
        this.detail = init.detail;
      }
      detail: unknown;
    }
    const location = { href, hostname: new URL(href).hostname };
    const run = new Function(
      "window",
      "document",
      "location",
      "localStorage",
      "CustomEvent",
      "requestAnimationFrame",
      "console",
      source,
    );
    run(window, document, location, localStorage, FakeCustomEvent, (fn: () => void) => fn(), console);
    const add = (slug: string) => {
      const node: Placeholder = {
        attrs: { "data-switchboard-form": slug },
        children: [],
        events: [],
        getAttribute(key) {
          return this.attrs[key] ?? null;
        },
        appendChild(child) {
          this.children.push(child);
        },
        dispatchEvent(event) {
          this.events.push({ type: event.type, detail: event.detail });
          return true;
        },
      };
      placeholders.push(node);
      return node;
    };
    const message = (event: unknown) => listeners.message?.forEach((fn) => fn(event));
    const api = window.Switchboard as { mount: () => void; setConsent: (granted: boolean) => void };
    return { window, add, created, message, mutate: () => observer?.(), api, storage };
  }

  const ORIGIN = "https://sb.example.com";

  it("mounts placeholders present at load and ones added later", () => {
    const env = load();
    env.add("book-a-demo");
    env.api.mount();
    expect(env.created.map((f) => f.src)).toEqual([`${ORIGIN}/f/book-a-demo?embed=1`]);
    env.add("pricing");
    env.mutate();
    expect(env.created).toHaveLength(2);
    env.mutate();
    expect(env.created).toHaveLength(2); // never mounts twice
  });

  it("passes a placeholder's theme attributes to the form", () => {
    const env = load();
    const node = env.add("book-a-demo");
    node.attrs["data-switchboard-accent"] = "#E4002B";
    node.attrs["data-switchboard-layout"] = "plain";
    node.attrs["data-switchboard-background"] = "transparent";
    env.api.mount();
    expect(env.created[0]!.src).toBe(
      `${ORIGIN}/f/book-a-demo?embed=1&accent=%23E4002B&layout=plain&bg=transparent`,
    );
  });

  it("resizes only for messages from its own iframe and origin", () => {
    const env = load();
    env.add("book-a-demo");
    env.api.mount();
    const iframe = env.created[0]!;
    const resize = { type: "switchboard:resize", height: 812.4 };
    env.message({ origin: "https://evil.example", source: iframe.contentWindow, data: resize });
    expect(iframe.style.height).toBeUndefined();
    env.message({ origin: ORIGIN, source: {}, data: resize });
    expect(iframe.style.height).toBeUndefined();
    env.message({ origin: ORIGIN, source: iframe.contentWindow, data: { ...resize, height: 99999 } });
    expect(iframe.style.height).toBeUndefined();
    env.message({ origin: ORIGIN, source: iframe.contentWindow, data: resize });
    expect(iframe.style.height).toBe("812px");
  });

  it("answers the form's ready message with the host page's attribution", () => {
    const env = load({
      href: "https://acme.example/pricing?utm_source=google&utm_medium=cpc&gclid=Cj0&email=x@y.co",
      referrer: "https://www.google.com/",
      cookie: "_ga=GA1.2.3.4; _fbp=fb.1.2",
    });
    env.add("book-a-demo");
    env.api.mount();
    const frame = env.created[0]!;
    env.message({ origin: ORIGIN, source: frame.contentWindow, data: { type: "switchboard:ready" } });
    const reply = frame.contentWindow.sent[0] as { type: string; attribution: Record<string, unknown> };
    expect(reply.type).toBe("switchboard:attribution");
    expect(reply.attribution).toMatchObject({
      utm_source: "google",
      utm_medium: "cpc",
      gclid: "Cj0",
      referrer: "https://www.google.com/",
      landing_page: "https://acme.example/pricing",
      page_url: "https://acme.example/pricing",
    });
    // No consent: cookies are not read and nothing is stored.
    expect(reply.attribution.cookies).toBeUndefined();
    expect(env.storage.size).toBe(0);
  });

  it("with consent, keeps first and last touch across pages and reads cookie IDs", () => {
    const storage = new Map<string, string>();
    load({ href: "https://acme.example/?utm_source=linkedin&utm_campaign=abm", consent: true, storage });
    // Later visit from a Google ad, then the lead opens the demo page directly.
    load({ href: "https://acme.example/?utm_source=google&gclid=g1", consent: true, storage });
    const env = load({
      href: "https://acme.example/demo",
      consent: true,
      storage,
      cookie: "_ga=GA1.2.3.4; _gcl_aw=GCL.1.g1; hubspotutk=abc; session=secret",
    });
    env.add("book-a-demo");
    env.api.mount();
    const frame = env.created[0]!;
    env.message({ origin: ORIGIN, source: frame.contentWindow, data: { type: "switchboard:ready" } });
    const { attribution } = frame.contentWindow.sent[0] as { attribution: Record<string, unknown> };
    expect(attribution).toMatchObject({
      utm_source: "google",
      gclid: "g1",
      first: { utm_source: "linkedin", utm_campaign: "abm" },
      page_url: "https://acme.example/demo",
      cookies: { ga: "GA1.2.3.4", gcl_aw: "GCL.1.g1", hubspotutk: "abc" },
    });
    expect(JSON.stringify(attribution)).not.toContain("secret");
  });

  it("setConsent(true) from a cookie banner starts storing and re-sends attribution", () => {
    const env = load({ href: "https://acme.example/?utm_source=bing", cookie: "_ga=GA1.9" });
    env.add("book-a-demo");
    env.api.mount();
    env.api.setConsent(true);
    expect(env.storage.size).toBe(1);
    const sent = env.created[0]!.contentWindow.sent as { attribution: { cookies?: unknown } }[];
    expect(sent.at(-1)?.attribution.cookies).toEqual({ ga: "GA1.9" });
  });

  it("forwards conversions to the dataLayer and as DOM events, without personal data", () => {
    const env = load();
    const node = env.add("book-a-demo");
    env.api.mount();
    const frame = env.created[0]!;
    env.message({
      origin: ORIGIN,
      source: frame.contentWindow,
      data: { type: "switchboard:event", name: "booked", outcome: "route_team", email: "x@y.co" },
    });
    env.message({
      origin: "https://evil.example",
      source: frame.contentWindow,
      data: { type: "switchboard:event", name: "booked" },
    });
    expect(env.window.dataLayer).toEqual([
      { event: "switchboard_booked", switchboard_form: "book-a-demo", switchboard_outcome: "route_team" },
    ]);
    expect(node.events).toEqual([
      { type: "switchboard:booked", detail: { form: "book-a-demo", outcome: "route_team" } },
    ]);
  });

  it("captures the same URL parameters the server accepts", async () => {
    const { URL_PARAMS } = await import("@switchboard/core");
    const list = /var PARAMS = \[([^\]]+)\]/.exec(source)?.[1] ?? "";
    expect(list.match(/"([a-z_]+)"/g)?.map((p) => p.slice(1, -1))).toEqual([...URL_PARAMS]);
  });
});
