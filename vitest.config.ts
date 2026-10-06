import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Repo-wide Vitest config; the only non-default behavior is the `@/` alias
 * apps/web uses for its own `src/` (mirrors apps/web/tsconfig.json paths).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "apps/web/src"),
    },
  },
});
