import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/**
 * Flat config.
 *
 * Order matters: the Next.js config installs its own parser globally, so the
 * type-aware TypeScript rules are applied afterwards and scoped to `.ts`/`.tsx`
 * with the TypeScript parser explicitly restored.
 */
export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "public/**",
      "*.config.mjs",
      // Not part of this application: an unrelated site that shares the git
      // history and is excluded from the Cedula PY archive.
      "rutafutbol-py/**",
    ],
  },
  js.configs.recommended,
  ...nextCoreWebVitals,
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      // Branding a validated value is an intentional assertion; the boundary
      // tests police everything that actually matters.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='eval']",
          message: "eval() is forbidden: persisted rules are data, never code.",
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: "new Function() is forbidden: persisted rules are data, never code.",
        },
      ],
    },
  },
  {
    // Test and tooling code legitimately builds partial shapes to exercise the
    // types under test.
    files: ["tests/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
);
