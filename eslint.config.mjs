import { defineConfig, globalIgnores } from 'eslint/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
})

export default defineConfig([
    globalIgnores([
        'app/**/*',
        'dist/**/*',
        'release/**/*',
        'src/environments/*',
        'e2e/playwright.config.ts',
    ]),
    {
        files: ['**/*.ts'],

        extends: compat.extends(
            'plugin:@angular-eslint/recommended',
            'eslint:recommended',
            'plugin:@typescript-eslint/recommended',
            'plugin:@typescript-eslint/recommended-requiring-type-checking',
            'plugin:@angular-eslint/template/process-inline-templates',
        ),

        languageOptions: {
            ecmaVersion: 5,
            sourceType: 'script',

            parserOptions: {
                project: [
                    './tsconfig.serve.json',
                    './src/tsconfig.app.json',
                    './src/tsconfig.spec.json',
                    './e2e/tsconfig.e2e.json',
                ],

                createDefaultProgram: true,
            },
        },

        rules: {
            '@typescript-eslint/no-empty-function': 'warn',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unsafe-assignment': 'warn',
            '@typescript-eslint/no-unsafe-call': 'warn',
            '@typescript-eslint/no-unsafe-member-access': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],

            '@angular-eslint/directive-selector': 'error',
            '@angular-eslint/component-selector': [
                'error',
                {
                    type: 'element',
                    prefix: 'app',
                    style: 'kebab-case',
                },
            ],

            'jsdoc/newline-after-description': 0,
        },
    },
    {
        files: ['**/*.html'],
        extends: compat.extends('plugin:@angular-eslint/template/recommended'),
        rules: {
            '@angular-eslint/template/eqeqeq': 'off',
        },
    },
])
