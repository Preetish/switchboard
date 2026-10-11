import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Repo-wide Vitest config: the `@/` alias apps/web uses for its own `src/`
 * (mirrors apps/web/tsconfig.json paths), and e2e/ left to Playwright.
 */
export default defineConfig({
  test: {
    // Browser tests run under Playwright (`npm run test:e2e`), not Vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "apps/web/src"),
    },
  },
});
