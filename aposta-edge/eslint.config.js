import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", ".wrangler/**", "node_modules/**", "src/routeTree.gen.ts", "src/components/ui/**"] },
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // JSX identifiers are not tracked without eslint-plugin-react.
      "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]|^React$", argsIgnorePattern: "^_|^[A-Z]", caughtErrors: "none", ignoreRestSiblings: true }],
    },
  },
];
