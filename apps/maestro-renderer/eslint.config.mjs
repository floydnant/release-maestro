import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import baseConfig from '../../eslint.config.mjs'

const projectRoot = dirname(fileURLToPath(import.meta.url))

/**
 * `@release-maestro/eslint-plugin-design-system`, by relative path: the workspace does not use npm
 * workspaces, so a library package name is not resolvable from `node_modules` the way it would be
 * for a published consumer. Everything else about the library is publish-ready.
 *
 * Class validation is scoped to this project on purpose. The plugin knows nothing about any design
 * system — the options below are what teach it this one — so registering it at the workspace root
 * would lint `maestro-electron` against a design system it does not use.
 */
const designSystem = createRequire(import.meta.url)(
    '../../libs/eslint-plugin-design-system/src/index.cjs',
)

const classValidationOptions = {
    tailwindConfig: join(projectRoot, 'tailwind.config.js'),
    globalStylesheets: [join(projectRoot, 'src/styles.css')],
    generatedTokenApi: join(projectRoot, 'src/app/shared/design-tokens.generated.ts'),
}

export default [
    ...baseConfig,
    {
        files: ['**/*.html'],
        plugins: { 'design-system': designSystem },
        rules: {
            'design-system/valid-template-classnames': ['error', classValidationOptions],
        },
    },
    {
        files: ['**/*.ts'],
        plugins: { 'design-system': designSystem },
        rules: {
            'design-system/valid-host-classnames': ['error', classValidationOptions],
        },
    },
]
