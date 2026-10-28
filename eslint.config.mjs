import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

const TS_FILES = ["**/*.{ts,tsx,mts,cts}"];

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/.next/**",
    "**/coverage/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/next-env.d.ts",
    // Planning documents and task prompts are not code.
    "docs/**",
    "prompts/**",
  ]),

  js.configs.recommended,

  // Type-aware TypeScript rules for every package. Each file is linted against the nearest tsconfig.json.
  {
    files: TS_FILES,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Plain JS files (for example this config) are not part of any tsconfig project.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Next.js, React, hooks and accessibility rules apply to the web app only.
  {
    files: ["apps/web/**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    extends: [nextCoreWebVitals],
    settings: {
      next: { rootDir: "apps/web" },
    },
  },
  // eslint-config-next only assigns the TypeScript parser to .ts/.tsx; give .mts/.cts the same
  // parser so the type-aware rules above can run on them (for example vitest.config.mts).
  {
    files: ["apps/web/**/*.{mts,cts}"],
    languageOptions: { parser: tseslint.parser },
  },

  // Repository-wide conventions. Kept last so they take precedence over presets.
  {
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "no-console": ["error", { allow: ["info", "warn", "error"] }],
    },
  },
  {
    files: TS_FILES,
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);
