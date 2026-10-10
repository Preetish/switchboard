import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/.next/",
      "**/node_modules/",
      "**/next-env.d.ts",
      // Generated: minified from packages/embed/embed.js (see its build script).
      "apps/web/public/embed.js",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
