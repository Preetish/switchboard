import {
  EMBED_THEME_KEYS,
  mergeThemes,
  schemeClass,
  themeCss,
  validateTheme,
  type Theme,
} from "@switchboard/core";
import type { FormSettings, OrgSettings } from "@switchboard/db";

/** Query parameter for each theme key an embed snippet may set. */
export const EMBED_THEME_PARAMS: Record<(typeof EMBED_THEME_KEYS)[number], string> = {
  accent: "accent",
  radius: "radius",
  colorScheme: "scheme",
  layout: "layout",
  background: "bg",
};

/**
 * Theme overrides from an embed snippet (`data-switchboard-accent`, …),
 * passed as query parameters. Each key is validated on its own; an invalid
 * value is ignored rather than breaking the form on a customer's page.
 */
export function embedOverrides(params: Record<string, string | string[] | undefined>): Theme {
  const theme: Theme = {};
  for (const key of EMBED_THEME_KEYS) {
    const raw = params[EMBED_THEME_PARAMS[key]];
    if (typeof raw !== "string" || raw === "") continue;
    const result = validateTheme({ [key]: key === "radius" ? Number(raw) : raw }, { allowFont: false });
    if (result.ok) Object.assign(theme, result.theme);
  }
  return theme;
}

/** The selector themed CSS is scoped to (doubled for specificity). */
export const THEME_SELECTOR = ".sb-themed.sb-themed";

export type ResolvedFormTheme = {
  theme: Theme;
  /** Class names for the page wrapper. */
  className: string;
  /** Validated theme CSS plus the admin's customCss. */
  css: string;
  fontStylesheet: string | null;
};

/** Org default, then the form's theme, then the embed snippet's overrides. */
export function resolveFormTheme(
  org: OrgSettings,
  form: FormSettings,
  overrides: Theme,
): ResolvedFormTheme {
  const theme = mergeThemes(org.theme, form.theme, overrides);
  const css = [themeCss(theme, THEME_SELECTOR), org.customCss, form.customCss]
    .filter(Boolean)
    .join("\n");
  return {
    theme,
    className: ["sb-themed", schemeClass(theme)].filter(Boolean).join(" "),
    css,
    fontStylesheet: theme.font?.stylesheet ?? null,
  };
}
