import { describe, expect, it } from "vitest";
import { safeDisplayName } from "@/lib/display-name";

describe("safeDisplayName", () => {
  it("keeps ordinary names, including non-Latin ones", () => {
    expect(safeDisplayName("Jane O'Neil-Smith")).toBe("Jane O'Neil-Smith");
    expect(safeDisplayName("  José   Núñez ")).toBe("José Núñez");
    expect(safeDisplayName("山田 太郎")).toBe("山田 太郎");
  });

  it("drops anything that could carry a link or a lure", () => {
    expect(safeDisplayName("Visit https://evil.example")).toBeNull();
    expect(safeDisplayName("evil.example/login")).toBeNull();
    expect(safeDisplayName("<b>Jane</b>")).toBeNull();
    expect(safeDisplayName("Account locked: call 555")).toBeNull();
    expect(safeDisplayName("a".repeat(61))).toBeNull();
    expect(safeDisplayName(42)).toBeNull();
  });
});
