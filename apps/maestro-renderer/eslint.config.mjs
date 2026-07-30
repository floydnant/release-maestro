import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import baseConfig from '../../eslint.config.mjs'

const projectRoot = dirname(fileURLToPath(import.meta.url))

// MAE-106 prototype: Angular-template-aware class validation, deliberately scoped to the renderer.
const designSystem = createRequire(import.meta.url)('./tools/eslint-plugin-design-system/index.cjs')

const classValidationOptions = {
    tailwindConfig: join(projectRoot, 'tailwind.config.js'),
    globalStylesheets: [join(projectRoot, 'src/styles.css')],
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
