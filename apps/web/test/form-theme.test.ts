import { describe, expect, it } from "vitest";
import { THEME_SELECTOR, embedOverrides, resolveFormTheme } from "@/lib/form-theme";

describe("embedOverrides", () => {
  it("reads the snippet's settings and skips invalid ones individually", () => {
    expect(
      embedOverrides({
        accent: "#e4002b",
        radius: "0",
        scheme: "dark",
        layout: "plain",
        bg: "javascript:alert(1)",
        font: "Comic Sans",
      }),
    ).toEqual({ accent: "#E4002B", radius: 0, colorScheme: "dark", layout: "plain" });
  });

  it("is empty when nothing is set", () => {
    expect(embedOverrides({ embed: "1" })).toEqual({});
  });
});

describe("resolveFormTheme", () => {
  it("layers org, form, and embed settings, and appends custom CSS in that order", () => {
    const look = resolveFormTheme(
      {
        theme: { accent: "#111111", radius: 4, font: { family: "Inter, sans-serif", stylesheet: "https://fonts.example/inter.css" } },
        customCss: ".sb-title { letter-spacing: 0 }",
      },
      { theme: { accent: "#0B5FFF", colorScheme: "light" }, customCss: ".sb-button { text-transform: uppercase }" },
      { layout: "plain" },
    );
    expect(look.theme).toMatchObject({ accent: "#0B5FFF", radius: 4, colorScheme: "light", layout: "plain" });
    expect(look.className).toBe("sb-themed sb-scheme-light");
    expect(look.fontStylesheet).toBe("https://fonts.example/inter.css");
    expect(look.css.startsWith(`${THEME_SELECTOR} {`)).toBe(true);
    expect(look.css.indexOf(".sb-title")).toBeLessThan(look.css.indexOf(".sb-button"));
  });

  it("adds nothing for an unthemed form", () => {
    expect(resolveFormTheme({}, {}, {})).toEqual({
      theme: {},
      className: "sb-themed",
      css: "",
      fontStylesheet: null,
    });
  });
});
