// ESLint for the GNOME Shell helper (GJS, ESM). Run from app/: `pnpm lint:helper`.
const gjsGlobals = {
  global: "readonly",
  console: "readonly",
  log: "readonly",
  logError: "readonly",
  print: "readonly",
  imports: "readonly",
};

export default [
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: gjsGlobals },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
      "no-implicit-globals": "error",
      "no-console": "off",
    },
  },
];
