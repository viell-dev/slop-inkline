// @ts-check
import obsidianmd from "eslint-plugin-obsidianmd";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    ".npm-cache/",
    ".obsidian-cache/",
    "coverage/",
    "dist/",
    "docs/.vitepress/dist/",
    "docs/.vitepress/cache/",
    "test-results/",
  ]),
  // The rules Obsidian's community directory review applies, to every file.
  obsidianmd.configs.recommended,
  {
    files: ["**/*.{ts,mts}"],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    rules: {
      // strictTypeChecked turns this back on. The recommended config runs
      // obsidianmd/no-misused-promises in its place, the same rule without
      // Obsidian's chaining then counted as a Promise, as the review does;
      // both together report every real Promise twice.
      "@typescript-eslint/no-misused-promises": "off",
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Each notice the plugin shows is marked as Inkline's, so that styles.css
  // keeps its English in order in a right-to-left interface (#267).
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "NewExpression[callee.name='Notice']:not(CallExpression[callee.name='markNotice'] > NewExpression)",
          message:
            "Show a notice as markNotice(new Notice(…)), from src/notices.ts, so that its English keeps its order in a right-to-left interface.",
        },
      ],
    },
  },
  // Development tools run in Node.js, not in Obsidian.
  {
    files: ["scripts/**", "test/**", "docs/.vitepress/**", "*.{js,mjs}"],
    languageOptions: { globals: globals.node },
    rules: {
      // Wraps no-console to point at Obsidian's logging guideline.
      "obsidianmd/rule-custom-message": "off",
      "no-console": "off",
      "obsidianmd/no-nodejs-modules": "off",
      "import/no-nodejs-modules": "off",
    },
  },
  // Scripts call GitHub's API with Node.js's own fetch, as Obsidian's
  // requestUrl does not exist there.
  {
    files: ["scripts/**"],
    rules: { "no-restricted-globals": "off" },
  },
);
