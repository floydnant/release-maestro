/**
 * MAE-106 prototype: Angular-template-aware class validation as ESLint rules.
 *
 * The plugin is deliberately small — two rules over one shared authority (Tailwind's own resolver
 * plus the authored stylesheets). See `README.md` for the evidence and known limits.
 */
const validTemplateClassnames = require('./rules/valid-template-classnames.cjs')
const validHostClassnames = require('./rules/valid-host-classnames.cjs')

module.exports = {
    meta: { name: 'eslint-plugin-design-system' },
    rules: {
        'valid-template-classnames': validTemplateClassnames,
        'valid-host-classnames': validHostClassnames,
    },
}
