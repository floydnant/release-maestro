/**
 * Combines the authorities — Tailwind's resolver and the authored stylesheets — into one question:
 * would this class name produce any CSS in this app?
 *
 * The plugin holds no knowledge of any particular app: every authority arrives as a rule option, so
 * the same rules work for a second consumer or a published package without editing anything here.
 */
const path = require('node:path')
const { classesFromCssFile, componentClassesForTemplate } = require('./css-classes.cjs')
const { isTypedTokenApi } = require('./generated-token-api.cjs')
const { suggestClassName } = require('./suggest.cjs')
const { isTailwindClass, tailwindClassList, themePathExists } = require('./tailwind-authority.cjs')

/**
 * @typedef {object} ClassCheckerOptions
 * @property {string} tailwindConfig path to the Tailwind config that defines the utility surface
 * @property {string[]} [globalStylesheets] stylesheets whose classes are valid everywhere; their
 *   relative `@import`s are followed
 * @property {string} [generatedTokenApi] a generated module whose exports may root an otherwise
 *   unresolvable class expression; omit to switch that acceptance off
 * @property {boolean} [reportDynamic] whether to report class lists that cannot be resolved
 *   statically. Defaults to true; turning it off is for narrowing a test, not for production use.
 */

/**
 * @param {string} target
 * @param {string} root
 * @returns {string}
 */
function resolveFromRoot(target, root) {
    return path.isAbsolute(target) ? target : path.resolve(root, target)
}

/**
 * @param {ClassCheckerOptions} options
 * @param {{ cwd?: string, filePath?: string }} context
 */
function createClassChecker(options, { cwd = process.cwd(), filePath } = {}) {
    const tailwindConfig = resolveFromRoot(options.tailwindConfig, cwd)
    const globalStylesheets = (options.globalStylesheets ?? []).map(sheet => resolveFromRoot(sheet, cwd))
    const generatedTokenApi = options.generatedTokenApi
        ? resolveFromRoot(options.generatedTokenApi, cwd)
        : null

    /** @type {Set<string>} */
    const globalClasses = new Set()
    for (const sheet of globalStylesheets) {
        for (const className of classesFromCssFile(sheet)) globalClasses.add(className)
    }

    const localClasses = filePath ? componentClassesForTemplate(filePath) : new Set()

    /** @param {string} className */
    const isValid = className =>
        globalClasses.has(className) ||
        localClasses.has(className) ||
        isTailwindClass(tailwindConfig, className)

    /**
     * Suggestions come from the same authorities that decide validity, so a suggested name is always
     * a name that would pass. Reported, never applied — automatic correction is out of scope.
     *
     * @param {string} className
     * @returns {string|null}
     */
    const suggest = className =>
        suggestClassName(className, [
            ...localClasses,
            ...globalClasses,
            ...tailwindClassList(tailwindConfig),
        ])

    /** @param {string} themePath */
    const isThemePath = themePath => themePathExists(tailwindConfig, themePath)

    /**
     * A class expression the rule cannot enumerate is still acceptable when it is rooted in the
     * generated token API — the TypeScript union there is the authority, so re-checking it here
     * would only duplicate it.
     *
     * @param {AngularExpression} node
     */
    const isTypedApiExpression = node =>
        generatedTokenApi !== null && isTypedTokenApi(node, generatedTokenApi)

    return { isThemePath, isTypedApiExpression, isValid, suggest }
}

const sharedSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['tailwindConfig'],
    properties: {
        tailwindConfig: { type: 'string' },
        globalStylesheets: { type: 'array', items: { type: 'string' } },
        generatedTokenApi: { type: 'string' },
        reportDynamic: { type: 'boolean' },
    },
}

module.exports = { createClassChecker, sharedSchema }
