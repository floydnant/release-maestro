/**
 * Combines the authorities — Tailwind's resolver and the authored stylesheets — into one question:
 * would this class name produce any CSS in this app?
 *
 * The plugin holds no knowledge of any particular app: every authority arrives as a rule option, so
 * the same rules work for a second consumer or a published package without editing anything here.
 */
const path = require('node:path')
const { classesFromCssFile, componentClassesForTemplate } = require('./css-classes.cjs')
const { suggestClassName } = require('./suggest.cjs')
const { isTailwindClass, tailwindClassList, themePathExists } = require('./tailwind-authority.cjs')

/**
 * @typedef {object} ClassCheckerOptions
 * @property {string} tailwindConfig path to the Tailwind config that defines the utility surface
 * @property {string[]} [globalStylesheets] stylesheets whose classes are valid everywhere; their
 *   relative `@import`s are followed
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
     * @returns {import('./suggest.cjs').Suggestion|null}
     */
    const suggest = className =>
        suggestClassName(className, [...localClasses, ...globalClasses, ...tailwindClassList(tailwindConfig)])

    /** @param {string} themePath */
    const isThemePath = themePath => themePathExists(tailwindConfig, themePath)

    return { isThemePath, isValid, suggest }
}

const sharedSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['tailwindConfig'],
    properties: {
        tailwindConfig: { type: 'string' },
        globalStylesheets: { type: 'array', items: { type: 'string' } },
        reportDynamic: { type: 'boolean' },

        /**
         * Resolve a component member through a `TypeChecker` when its class list is not enumerable
         * from the component file's syntax alone. Off by default: it builds a TypeScript program,
         * which the plugin should not impose on a consumer that has not asked for it. See
         * `type-program.cjs` for what it costs and when it is paid.
         */
        resolveTypes: { type: 'boolean' },
        /** The tsconfig to build that program from. Discovered from the component file when unset. */
        tsconfig: { type: 'string' },
    },
}

module.exports = { createClassChecker, sharedSchema }
