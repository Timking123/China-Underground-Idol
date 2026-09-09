import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "site/**",
      "reports/**",
      "private/store/**",
      "private/imports/**",
      "private/weekly-runtime/**",
      "private/weekly-application-v2/**",
    ],
  },
  js.configs.recommended,
  { files: ["private/**/*.ts"], extends: [tseslint.configs.recommended] },
  {
    languageOptions: {
      globals: Object.fromEntries(
        [
          "process",
          "Buffer",
          "console",
          "URL",
          "URLSearchParams",
          "TextEncoder",
          "TextDecoder",
          "setTimeout",
          "clearTimeout",
          "fetch",
          "AbortSignal",
          "AbortController",
          "Response",
          "HTMLElement",
          "HTMLAnchorElement",
        ].map((name) => [name, "readonly"]),
      ),
    },
  },
  {
    files: [
      "private/tests/pipeline.test.mjs",
      "private/tests/server*.mjs",
      "private/server/**/*.ts",
    ],
    languageOptions: { globals: { structuredClone: "readonly" } },
  },
);
