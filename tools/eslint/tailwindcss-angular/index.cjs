'use strict'

/**
 * PROTOTYPE (MAE-105) — repo-local ESLint plugin that adapts
 * `eslint-plugin-tailwindcss` to Angular templates. See
 * `docs/prototypes/mae-105-eslint-plugin-tailwindcss.md`.
 */

const noCustomClassname = require('./no-custom-classname.cjs')

module.exports = {
    meta: { name: 'eslint-plugin-tailwindcss-angular' },
    rules: {
        'no-custom-classname': noCustomClassname,
    },
}
