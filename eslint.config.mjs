import parser from "@typescript-eslint/parser";
import plugin from "@typescript-eslint/eslint-plugin";

export default [
    {
        files: ["src/**/*.ts", "src/**/*.tsx"],
        languageOptions: {
            parser: parser,
            parserOptions: {
                ecmaVersion: 2020,
                sourceType: "module"
            }
        },
        plugins: {
            "@typescript-eslint": plugin
        },
        rules: {
            ...plugin.configs.recommended.rules,
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }]
        }
    },
    {
        ignores: ["dist/", "node_modules/", "examples/", "rollup.config.js", ".eslintrc.cjs"]
    }
];