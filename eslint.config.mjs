import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "assets/**", "data.js", ".build/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.recommended],
  },
  {
    languageOptions: {
      globals: Object.fromEntries(
        [
          "performance",
          "DOMPoint",
          "window",
          "document",
          "URL",
          "URLSearchParams",
          "console",
          "process",
          "Buffer",
          "setTimeout",
          "clearTimeout",
          "requestAnimationFrame",
          "cancelAnimationFrame",
          "navigator",
          "Blob",
          "HTMLElement",
          "HTMLAnchorElement",
          "HTMLInputElement",
          "HTMLSelectElement",
          "HTMLTextAreaElement",
          "HTMLFormElement",
          "HTMLButtonElement",
          "HTMLDetailsElement",
          "CustomEvent",
          "Event",
          "TextEncoder",
          "AbortController",
        ].map((name) => [name, "readonly"]),
      ),
    },
  },
);
