import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

/**
 * ESLint configuration for Jebbit MCP Server
 */
export default [
  {
    files: ["src/**/*.ts", "scripts/**/*.mjs"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: "module"
      },
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        global: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        clearImmediate: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        setImmediate: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      // Code style
      "indent": ["error", 2],
      "quotes": ["error", "double"],
      "semi": ["error", "always"],
      "comma-dangle": ["error", "never"],
      "no-trailing-spaces": "error",
      "eol-last": "error",

      // Variables
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "error",
      "no-undef": "off",

      // Functions
      "no-unreachable": "error",
      "consistent-return": "error",
      "no-return-assign": "error",

      // Objects and arrays
      "object-curly-spacing": ["error", "always"],
      "array-bracket-spacing": ["error", "never"],
      "comma-spacing": ["error", { "before": false, "after": true }],

      // Control flow
      "no-else-return": "error",
      "no-lonely-if": "error",
      "no-duplicate-case": "error",

      // ES6+
      "prefer-const": "error",
      "no-var": "error",
      "prefer-arrow-callback": "error",
      "arrow-spacing": "error",
      "template-curly-spacing": "error",

      // Async/await
      "require-await": "error",
      "no-async-promise-executor": "error",

      // Error handling
      "no-throw-literal": "error",

      // Performance
      "no-loop-func": "error",

      // Best practices
      "eqeqeq": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-wrappers": "error",
      "radix": "error"
    }
  },
  {
    files: ["src/__tests__/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: "module"
      },
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        jest: "readonly"
      }
    },
    rules: {
      // Test-specific rules
      "no-unused-expressions": "off"
    }
  }
];
