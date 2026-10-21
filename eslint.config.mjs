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
  // Development tools run in Node.js, not in Obsidian.
  {
    files: ["scripts/**", "test/**", "*.{js,mjs}"],
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
