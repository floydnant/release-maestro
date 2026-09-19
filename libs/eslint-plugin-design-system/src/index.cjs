/**
 * Angular-template-aware design-system class validation as ESLint rules.
 *
 * The plugin is deliberately small — class validation over one shared authority (Tailwind's own resolver
 * plus the authored stylesheets). See `README.md` for how it decides and where it stops, and the
 * `frontend-design` skill for the convention it enforces.
 */
const validTemplateClassnames = require('./rules/valid-template-classnames.cjs')
const validHostClassnames = require('./rules/valid-host-classnames.cjs')
const noImperativeClasses = require('./rules/no-imperative-classes.cjs')

/** @type {import('eslint').ESLint.Plugin} */
module.exports = {
    meta: { name: 'eslint-plugin-design-system' },
    rules: {
        'valid-template-classnames': validTemplateClassnames,
        'valid-host-classnames': validHostClassnames,
        'no-imperative-classes': noImperativeClasses,
    },
}
