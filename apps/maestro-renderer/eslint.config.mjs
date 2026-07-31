import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import baseConfig from '../../eslint.config.mjs'

const projectRoot = dirname(fileURLToPath(import.meta.url))

/**
 * Class validation is scoped to this project on purpose: the authorities it checks against are the
 * renderer's Tailwind config and the renderer's stylesheets, so registering it at the workspace root
 * would lint `maestro-electron` against a design system it does not use.
 */
const designSystem = createRequire(import.meta.url)('./tools/eslint-plugin-design-system/index.cjs')

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
