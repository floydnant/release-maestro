/// <reference types="../../libs/eslint-plugin-design-system/src/types" />

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import baseConfig from '../../eslint.config.mjs'

const projectRoot = dirname(fileURLToPath(import.meta.url))

/**
 * `@release-maestro/eslint-plugin-design-system`, by relative path: the renderer intentionally
 * loads the plugin's source instead of a built package. Everything else about the library is
 * publish-ready.
 *
 * Class validation is scoped to this project on purpose. The plugin knows nothing about any design
 * system — the options below are what teach it this one — so registering it at the workspace root
 * would lint `maestro-electron` against a design system it does not use.
 */
const designSystem = createRequire(import.meta.url)('../../libs/eslint-plugin-design-system/src/index.cjs')

/** @type {ClassCheckerOptions} */
const classValidationOptions = {
    tailwindStylesheet: join(projectRoot, 'src/styles.css'),
    globalStylesheets: [join(projectRoot, 'src/styles.css')],
}

// Copied Helm components retain their upstream element and attribute aliases. Product components
// keep the app-* selector rules from the workspace configuration.
const helmSelectorOptions = [
    { type: 'element', prefix: 'hlm', style: 'kebab-case' },
    { type: 'attribute', prefix: 'hlm', style: 'camelCase' },
]

// Typography is generated as plain CSS selectors, which Tailwind's candidate parser does not
// recognize. Read the exact generated vocabulary instead of permitting an open type-* pattern.
const typographyClassNames = Array.from(
    readFileSync(join(projectRoot, 'src/styles/design-tokens.generated.css'), 'utf8').matchAll(
        /^\.(type-[\w-]+)\s*\{/gm,
    ),
    ([, className]) => `^${className}$`,
)
const moduleBoundaryOptions = baseConfig.find(config => config.rules?.['@nx/enforce-module-boundaries'])
    .rules['@nx/enforce-module-boundaries'][1]

export default [
    ...baseConfig,
    {
        files: ['**/*.html'],
        plugins: { 'design-system': designSystem },
        rules: {
            'design-system/valid-template-classnames': [
                'error',
                {
                    ...classValidationOptions,
                    // These inputs style native-select's inner elements rather than its host.
                    additionalClassAttributes: ['selectClass', 'selectIconClass'],
                    /**
                     * Resolve a class list through the component's *types* when its syntax is not
                     * enumerable — an `as const`, a union alias imported from elsewhere, a
                     * `signal<'a'|'b'>()`, an inherited member.
                     *
                     * This builds a TypeScript program, lazily: nothing is constructed until a
                     * class binding names a member the syntactic pass could not enumerate, so a
                     * template with no dynamic class list costs nothing. Measured on this project —
                     * ~1.1s for the first build, ~80ms per rebuild after an edit, which in an
                     * editor's long-lived ESLint server is a one-off at session start.
                     */
                    resolveTypes: true,
                    tsconfig: join(projectRoot, 'tsconfig.app.json'),
                },
            ],
        },
    },
    {
        files: ['**/*.ts'],
        plugins: { 'design-system': designSystem },
        rules: {
            'design-system/valid-host-classnames': ['error', classValidationOptions],
        },
    },
    {
        basePath: projectRoot,
        files: ['src/app/**/*.ts'],
        rules: {
            'design-system/valid-imperative-classnames': ['error', classValidationOptions],
            // These canonical imports resolve to owned local families, including calls between
            // copied Helm components. All other workspace boundary options still apply.
            '@nx/enforce-module-boundaries': [
                'warn',
                {
                    ...moduleBoundaryOptions,
                    allow: [...moduleBoundaryOptions.allow, '@spartan-ng/helm/*'],
                },
            ],
        },
    },
    {
        basePath: projectRoot,
        files: ['src/app/shared/ui/**/*.ts'],
        settings: {
            tailwindcss: {
                // Validate the literal classes in CVA variants and Helm's class-merging calls.
                // Dynamic merging remains inside the copied helpers; product bindings retain the
                // design-system rules above.
                functions: [
                    'classnames',
                    'classNames',
                    'clsx',
                    'cn',
                    'ctl',
                    'cva',
                    'tv',
                    'tw',
                    'twMerge',
                    'twJoin',
                    'hlm',
                ],
            },
        },
        rules: {
            '@angular-eslint/component-selector': ['error', helmSelectorOptions],
            '@angular-eslint/directive-selector': ['error', helmSelectorOptions],
            // Preserve upstream class overrides, the native-select value API and its explicit
            // ARIA validity/description overrides. Other aliases keep their usual selector contract.
            '@angular-eslint/no-input-rename': [
                'error',
                { allowedNames: ['class', 'value', 'aria-invalid', 'aria-describedby'] },
            ],
            'tailwindcss/no-custom-classname': ['error', { whitelist: typographyClassNames }],
        },
    },
]
