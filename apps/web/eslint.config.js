import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files:   ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Classic hooks rules — downgraded to "warn" for initial rollout so
      // CI doesn't fail on the existing codebase. Promote to "error" over time.
      "react-hooks/rules-of-hooks":               "warn",
      "react-hooks/exhaustive-deps":              "warn",

      // TypeScript rules — downgraded from recommended "error" for initial rollout.
      "@typescript-eslint/no-explicit-any":        "warn",
      "@typescript-eslint/no-unused-vars":         ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-unused-expressions":  "warn",
      "no-empty":                                  "warn",
    },
  },
);
