import nx from '@nx/eslint-plugin'
import tailwind from 'eslint-plugin-tailwindcss'
import { defineConfig } from 'eslint/config'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = dirname(fileURLToPath(import.meta.url))
const tailwindConfig = join(workspaceRoot, 'apps/maestro-renderer/tailwind.config.js')
const tailwindRules = tailwind.configs['flat/recommended'].find(config => config.rules)?.rules ?? {}

export default defineConfig([
    ...nx.configs['flat/base'],
    ...nx.configs['flat/typescript'],
    ...nx.configs['flat/javascript'],
    {
        ignores: ['**/dist', 'release/**/*', '**/eslint.config.mjs'],
    },
    {
        files: ['**/package.json'],
        rules: {
            '@nx/dependency-checks': [
                'error',
                {
                    ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
                    ignoredDependencies: ['tslib'],
                },
            ],
        },
        languageOptions: {
            parser: (await import('jsonc-eslint-parser')).default,
        },
    },
    {
        files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts', '**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
        rules: {
            '@nx/enforce-module-boundaries': [
                'warn',
                {
                    enforceBuildableLibDependency: true,
                    allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
                    depConstraints: [
                        {
                            sourceTag: '*',
                            onlyDependOnLibsWithTags: ['*'],
                        },
                    ],
                },
            ],
            '@typescript-eslint/no-empty-function': 'warn',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-inferrable-types': 'warn',
        },
    },
    {
        files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts'],
        languageOptions: {
            ecmaVersion: 5,
            sourceType: 'script',

            parserOptions: {
                project: [
                    // @TODO: this probably means the respective tsconfig
                    // files for each project get disregarded?
                    './tsconfig.base.json',
                ],

                createDefaultProgram: true,
            },
        },
    },
    ...nx.configs['flat/angular'],
    ...nx.configs['flat/angular-template'],
    {
        files: ['**/*.ts'],
        rules: {
            '@angular-eslint/directive-selector': [
                'error',
                {
                    type: 'attribute',
                    prefix: 'app',
                    style: 'camelCase',
                },
            ],
            '@angular-eslint/component-selector': [
                'error',
                {
                    type: 'element',
                    prefix: 'app',
                    style: 'kebab-case',
                },
            ],
        },
    },
    {
        files: ['**/*.html'],
        rules: {
            '@angular-eslint/template/eqeqeq': 'off',
        },
    },
    {
        files: ['**/*.html', '**/*.ts'],
        plugins: { tailwindcss: tailwind },
        settings: {
            tailwindcss: {
                config: tailwindConfig,
            },
        },
        rules: {
            ...tailwindRules,
            // Class ordering is owned by prettier-plugin-tailwindcss to avoid conflicts
            'tailwindcss/classnames-order': 'off',
            'tailwindcss/no-custom-classname': 'off',
        },
    },
])
