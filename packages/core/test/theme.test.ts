import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  mergeThemes,
  readableOn,
  schemeClass,
  textOn,
  themeCss,
  validateCustomCss,
  validateTheme,
} from "../src/index.js";

describe("validateTheme", () => {
  it("accepts a full theme from switchboard.yaml", () => {
    const result = validateTheme({
      accent: "#0b5fff",
      radius: 6,
      font: { family: "Inter, system-ui, sans-serif", stylesheet: "https://fonts.googleapis.com/css2?family=Inter" },
      colorScheme: "light",
      layout: "plain",
      background: "transparent",
    });
    expect(result).toEqual({
      ok: true,
      warnings: [],
      theme: {
        accent: "#0B5FFF",
        radius: 6,
        font: { family: "Inter, system-ui, sans-serif", stylesheet: "https://fonts.googleapis.com/css2?family=Inter" },
        colorScheme: "light",
        layout: "plain",
        background: "transparent",
      },
    });
  });

  it("rejects anything that could inject CSS", () => {
    const result = validateTheme(
      {
        accent: "red; } body { display:none",
        radius: "6px",
        background: "url(https://evil.example/x.png)",
        font: { family: "Inter; } * { color: red", stylesheet: "http://insecure.example/font.css" },
        colorScheme: "sepia",
        layout: "grid",
        extra: 1,
      },
      { allowFont: true, where: "theme" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(7);
      expect(result.errors.join("\n")).toMatch(/theme\.accent: use a hex color/);
      expect(result.errors.join("\n")).toMatch(/theme\.extra: not a theme setting/);
    }
  });

  it("doesn't let embed snippets set fonts", () => {
    const result = validateTheme({ font: { family: "Inter" } }, { allowFont: false });
    expect(!result.ok && result.errors[0]).toMatch(/font: not a theme setting/);
  });

  it("warns when the accent is too faint to see", () => {
    const light = validateTheme({ accent: "#FFE9A8", colorScheme: "light" });
    expect(light.ok && light.warnings[0]).toMatch(/faint on the light background/);
    const dark = validateTheme({ accent: "#1A1A40" });
    expect(dark.ok && dark.warnings.join()).toMatch(/faint on the dark background/);
  });
});

describe("contrast helpers", () => {
  it("picks readable button text for light and dark accents", () => {
    expect(textOn("#0B5FFF")).toBe("#FFFFFF");
    expect(textOn("#FFD400")).toBe("#16130E");
  });

  it("adjusts accent-colored text until it passes AA on the surface", () => {
    const text = readableOn("#FFD400", "#FFFFFF");
    expect(contrastRatio(text, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    const onDark = readableOn("#2A1FA0", "#16130E");
    expect(contrastRatio(onDark, "#16130E")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("mergeThemes", () => {
  it("lets the form override the org and the embed override both", () => {
    expect(
      mergeThemes({ accent: "#111111", radius: 4 }, { accent: "#222222" }, { layout: "plain", radius: undefined }),
    ).toEqual({ accent: "#222222", radius: 4, layout: "plain" });
  });
});

describe("themeCss", () => {
  it("emits token overrides scoped to the selector, with a dark variant for auto", () => {
    const css = themeCss({ accent: "#0B5FFF", radius: 8, font: { family: "Inter, sans-serif" } }, ".t");
    expect(css).toContain(".t { --sb-radius-sm: 6px; --sb-radius-md: 8px; --sb-radius-lg: 12px; --sb-font-sans: Inter, sans-serif;");
    expect(css).toContain("--sb-accent-strong: #0B5FFF");
    expect(css).toContain("--sb-text-on-accent: #FFFFFF");
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{ \.t \{ .*--sb-accent-text: /);
  });

  it("emits a single block for a forced scheme, and plain-layout surfaces", () => {
    const css = themeCss({ colorScheme: "dark", layout: "plain", background: "#101820" }, ".t");
    expect(css).not.toContain("@media");
    expect(css).toContain("--sb-form-surface: transparent");
    expect(css).toContain("--sb-page-bg: #101820");
    expect(schemeClass({ colorScheme: "dark" })).toBe("sb-scheme-dark");
    expect(schemeClass({})).toBeNull();
  });

  it("is empty for an empty theme", () => {
    expect(themeCss({}, ".t")).toBe("");
  });
});

describe("validateCustomCss", () => {
  it("accepts ordinary CSS", () => {
    expect(validateCustomCss(".sb-form h1 { letter-spacing: 0 }", "customCss").ok).toBe(true);
  });

  it("rejects closing the style tag and loading remote resources", () => {
    for (const css of ["</style><script>alert(1)</script>", "@import 'https://x';", "a { background: url(https://x) }"]) {
      expect(validateCustomCss(css, "customCss").ok).toBe(false);
    }
  });
});
