import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files:   ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any":       "warn",
      "@typescript-eslint/no-unused-vars":        ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-empty":                                 "warn",
    },
  },
);
