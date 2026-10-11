/**
 * Form themes: how an org (or one form, or one embed) makes the hosted form
 * look like its own site.
 *
 * Every value is validated here and turned into CSS custom properties that
 * the form's components already use, so nothing a theme says is pasted into
 * CSS as-is. Contrast is enforced by construction: the text on the accent is
 * picked to stay readable, and accent-colored text is darkened or lightened
 * until it meets WCAG AA on the surface.
 */

export type ColorScheme = "light" | "dark" | "auto";
export type Layout = "card" | "plain";

export type Theme = {
  /** Buttons, selected day and time, focus rings. `#RGB` or `#RRGGBB`. */
  accent?: string;
  /** Corner radius in px for buttons, inputs, and the card (0 to 24). */
  radius?: number;
  font?: {
    /** CSS font-family list, e.g. `Inter, system-ui, sans-serif`. */
    family: string;
    /** Optional https stylesheet that loads the font (e.g. Google Fonts). */
    stylesheet?: string;
  };
  /** Force light or dark, or follow the visitor's setting (`auto`). */
  colorScheme?: ColorScheme;
  /** `card`: bordered panel. `plain`: fields only, blending into your page. */
  layout?: Layout;
  /** Page background behind the form: `transparent` or a color. */
  background?: string;
};

/** Keys an embed snippet may override (no fonts: they load external CSS). */
export const EMBED_THEME_KEYS = ["accent", "radius", "colorScheme", "layout", "background"] as const;

export type ThemeResult = { ok: true; theme: Theme; warnings: string[] } | { ok: false; errors: string[] };

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const FONT_FAMILY_RE = /^[A-Za-z0-9 ,'"\-]+$/;
const SCHEMES: readonly ColorScheme[] = ["light", "dark", "auto"];
const LAYOUTS: readonly Layout[] = ["card", "plain"];

/** Surfaces the form draws on, per scheme (from packages/ui tokens). */
export const SURFACES = {
  light: { surface: "#FFFFFF", background: "#FBFAF9", text: "#16130E" },
  dark: { surface: "#16130E", background: "#0B0905", text: "#F4F2EF" },
} as const;

type Rgb = [number, number, number];

export function parseHex(value: string): Rgb | null {
  if (!HEX_RE.test(value)) return null;
  let hex = value.slice(1);
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(parseHex(a)!);
  const lb = luminance(parseHex(b)!);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return a.map((c, i) => c + (b[i]! - c) * amount) as Rgb;
}

/** White or near-black text, whichever is more readable on `color`. */
export function textOn(color: string): string {
  return contrastRatio(color, "#FFFFFF") >= contrastRatio(color, "#16130E") ? "#FFFFFF" : "#16130E";
}

/**
 * `color` adjusted toward black (light surfaces) or white (dark surfaces)
 * just enough to reach `target` contrast on `surface`, for accent-colored
 * text and focus rings.
 */
export function readableOn(color: string, surface: string, target = 4.5): string {
  const base = parseHex(color)!;
  const toward: Rgb = luminance(parseHex(surface)!) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let step = 0; step <= 20; step++) {
    const candidate = toHex(mix(base, toward, step * 0.05));
    if (contrastRatio(candidate, surface) >= target) return candidate;
  }
  return toHex(toward);
}

/**
 * Validate a theme from switchboard.yaml (`allowFont`) or from an embed
 * snippet (fonts not allowed). Returns readable errors, plus warnings for
 * themes that are valid but hard to see.
 */
export function validateTheme(
  raw: unknown,
  options: { allowFont: boolean; where?: string } = { allowFont: true },
): ThemeResult {
  const where = options.where ? `${options.where}.` : "";
  if (raw === undefined || raw === null) return { ok: true, theme: {}, warnings: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: [`${where.slice(0, -1) || "theme"}: expected settings like { accent: "#0B5FFF" }`] };
  }
  const input = raw as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];
  const theme: Theme = {};
  const allowed = options.allowFont
    ? ["accent", "radius", "font", "colorScheme", "layout", "background"]
    : [...EMBED_THEME_KEYS];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) errors.push(`${where}${key}: not a theme setting (use ${allowed.join(", ")})`);
  }

  if (input.accent !== undefined) {
    if (typeof input.accent === "string" && HEX_RE.test(input.accent)) theme.accent = input.accent.toUpperCase();
    else errors.push(`${where}accent: use a hex color like "#0B5FFF"`);
  }
  if (input.radius !== undefined) {
    const radius = Number(input.radius);
    if (Number.isInteger(radius) && radius >= 0 && radius <= 24) theme.radius = radius;
    else errors.push(`${where}radius: a whole number of pixels from 0 to 24`);
  }
  if (input.colorScheme !== undefined) {
    if (SCHEMES.includes(input.colorScheme as ColorScheme)) theme.colorScheme = input.colorScheme as ColorScheme;
    else errors.push(`${where}colorScheme: light, dark, or auto`);
  }
  if (input.layout !== undefined) {
    if (LAYOUTS.includes(input.layout as Layout)) theme.layout = input.layout as Layout;
    else errors.push(`${where}layout: card or plain`);
  }
  if (input.background !== undefined) {
    if (input.background === "transparent" || (typeof input.background === "string" && HEX_RE.test(input.background))) {
      theme.background = input.background === "transparent" ? "transparent" : input.background.toUpperCase();
    } else {
      errors.push(`${where}background: "transparent" or a hex color`);
    }
  }
  if (input.font !== undefined && options.allowFont) {
    const font = input.font as Record<string, unknown> | null;
    const family = typeof font === "object" && font !== null ? font.family : undefined;
    const stylesheet = typeof font === "object" && font !== null ? font.stylesheet : undefined;
    if (typeof family !== "string" || !FONT_FAMILY_RE.test(family) || family.length > 200) {
      errors.push(`${where}font.family: a CSS font list like "Inter, system-ui, sans-serif"`);
    } else {
      theme.font = { family };
      if (stylesheet !== undefined) {
        let ok = false;
        try {
          ok = typeof stylesheet === "string" && stylesheet.length <= 500 && new URL(stylesheet).protocol === "https:";
        } catch {
          ok = false;
        }
        if (ok) theme.font.stylesheet = stylesheet as string;
        else errors.push(`${where}font.stylesheet: an https URL to a stylesheet`);
      }
    }
  }

  if (theme.accent) {
    const schemes = theme.colorScheme === "dark" ? ["dark"] : theme.colorScheme === "light" ? ["light"] : ["light", "dark"];
    for (const scheme of schemes as ("light" | "dark")[]) {
      if (contrastRatio(theme.accent, SURFACES[scheme].surface) < 3) {
        warnings.push(
          `${where}accent ${theme.accent} is faint on the ${scheme} background (under 3:1); buttons will be hard to see${scheme === "dark" ? ' (set colorScheme: light, or pick a brighter accent)' : ""}`,
        );
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, theme, warnings };
}

/** Later layers win: org default, then form, then embed snippet. */
export function mergeThemes(...layers: (Theme | null | undefined)[]): Theme {
  const merged: Theme = {};
  for (const layer of layers) {
    if (layer) Object.assign(merged, Object.fromEntries(Object.entries(layer).filter(([, v]) => v !== undefined)));
  }
  return merged;
}

function schemeVars(theme: Theme, scheme: "light" | "dark"): string[] {
  const { surface } = SURFACES[scheme];
  const vars: string[] = [];
  if (theme.accent) {
    vars.push(
      `--sb-accent: ${theme.accent}`,
      `--sb-accent-strong: ${theme.accent}`,
      `--sb-text-on-accent: ${textOn(theme.accent)}`,
      `--sb-accent-text: ${readableOn(theme.accent, surface)}`,
      `--sb-accent-soft: color-mix(in srgb, ${theme.accent} ${scheme === "dark" ? 24 : 14}%, ${surface})`,
    );
  }
  if (theme.layout === "plain") {
    // Fields sit straight on the customer's section: no panel, full width,
    // and translucent field surfaces so they read on any background color.
    vars.push(
      `--sb-form-surface: transparent`,
      `--sb-form-border: transparent`,
      `--sb-form-padding: 0`,
      `--sb-form-max-width: none`,
      `--sb-surface: color-mix(in srgb, var(--sb-text) 5%, transparent)`,
      `--sb-border: color-mix(in srgb, var(--sb-text) 18%, transparent)`,
    );
  }
  if (theme.background) vars.push(`--sb-page-bg: ${theme.background}`);
  return vars;
}

/**
 * CSS for a themed form, scoped to `selector`. Built only from validated
 * values. `auto` emits light values plus a dark-mode media query.
 */
export function themeCss(theme: Theme, selector: string): string {
  const common: string[] = [];
  if (theme.radius !== undefined) {
    const r = theme.radius;
    common.push(
      `--sb-radius-sm: ${Math.round(r * 0.75)}px`,
      `--sb-radius-md: ${r}px`,
      `--sb-radius-lg: ${Math.round(r * 1.5)}px`,
    );
  }
  if (theme.font) common.push(`--sb-font-sans: ${theme.font.family}`);
  const block = (vars: string[]) => (vars.length ? `${selector} { ${vars.join("; ")}; }` : "");
  const scheme = theme.colorScheme ?? "auto";
  if (scheme !== "auto") return [block([...common, ...schemeVars(theme, scheme)])].filter(Boolean).join("\n");
  const dark = schemeVars(theme, "dark");
  return [
    block([...common, ...schemeVars(theme, "light")]),
    dark.length ? `@media (prefers-color-scheme: dark) { ${block(dark)} }` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A forced scheme's class (see packages/ui tokens), or null for auto. */
export function schemeClass(theme: Theme): string | null {
  return theme.colorScheme === "light" ? "sb-scheme-light" : theme.colorScheme === "dark" ? "sb-scheme-dark" : null;
}

const MAX_CUSTOM_CSS = 10_000;

/**
 * Admin-written CSS from switchboard.yaml. It can't close the <style> tag it
 * is placed in, and it can't load remote resources: forms collect personal
 * data, so a stray `url()` or `@import` shouldn't be able to phone home.
 */
export function validateCustomCss(css: unknown, where: string): { ok: true; css: string } | { ok: false; error: string } {
  if (typeof css !== "string") return { ok: false, error: `${where}: a string of CSS` };
  if (css.length > MAX_CUSTOM_CSS) return { ok: false, error: `${where}: keep it under ${MAX_CUSTOM_CSS} characters` };
  if (/<\/?style|<!--|-->/i.test(css)) return { ok: false, error: `${where}: can't contain <style> tags or HTML comments` };
  if (/@import|url\s*\(|expression\s*\(/i.test(css)) {
    return { ok: false, error: `${where}: @import, url(), and expression() aren't allowed; load fonts with theme.font.stylesheet` };
  }
  return { ok: true, css };
}
