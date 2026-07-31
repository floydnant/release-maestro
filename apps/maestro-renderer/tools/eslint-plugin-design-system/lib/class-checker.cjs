/**
 * Combines the two authorities — Tailwind's resolver and the authored stylesheets — into one
 * question: would this class name produce any CSS in this app?
 */
const path = require('node:path')
const { classesFromCssFile, componentClassesForTemplate } = require('./css-classes.cjs')
const { DEFAULT_GENERATED_TOKEN_API, isTypedTokenApi } = require('./generated-token-api.cjs')
const { suggestClassName } = require('./suggest.cjs')
const { isTailwindClass, tailwindClassList, themePathExists } = require('./tailwind-authority.cjs')

const DEFAULT_TAILWIND_CONFIG = 'apps/maestro-renderer/tailwind.config.js'
const DEFAULT_GLOBAL_STYLESHEETS = ['apps/maestro-renderer/src/styles.css']

function resolveFromRoot(target, root) {
    return path.isAbsolute(target) ? target : path.resolve(root, target)
}

function createClassChecker(options = {}, { cwd = process.cwd(), filePath } = {}) {
    const tailwindConfig = resolveFromRoot(options.tailwindConfig ?? DEFAULT_TAILWIND_CONFIG, cwd)
    const globalStylesheets = (options.globalStylesheets ?? DEFAULT_GLOBAL_STYLESHEETS).map(sheet =>
        resolveFromRoot(sheet, cwd),
    )
    const generatedTokenApi = resolveFromRoot(
        options.generatedTokenApi ?? DEFAULT_GENERATED_TOKEN_API,
        cwd,
    )

    const globalClasses = new Set()
    for (const sheet of globalStylesheets) {
        for (const className of classesFromCssFile(sheet)) globalClasses.add(className)
    }

    const localClasses = filePath ? componentClassesForTemplate(filePath) : new Set()

    const isValid = className =>
        globalClasses.has(className) ||
        localClasses.has(className) ||
        isTailwindClass(tailwindConfig, className)

    /**
     * Suggestions come from the same authorities that decide validity, so a suggested name is always
     * a name that would pass. Reported, never applied — MAE-100 rules out automatic correction.
     */
    const suggest = className =>
        suggestClassName(className, [...localClasses, ...globalClasses, ...tailwindClassList(tailwindConfig)])

    const isThemePath = themePath => themePathExists(tailwindConfig, themePath)

    /**
     * A class expression the rule cannot enumerate is still acceptable when it is rooted in the
     * generated token API — the TypeScript union there is the authority, so re-checking it here
     * would only duplicate it.
     */
    const isTypedApiExpression = node => isTypedTokenApi(node, generatedTokenApi)

    return { isThemePath, isTypedApiExpression, isValid, suggest }
}

const sharedSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        tailwindConfig: { type: 'string' },
        globalStylesheets: { type: 'array', items: { type: 'string' } },
        generatedTokenApi: { type: 'string' },
        reportDynamic: { type: 'boolean' },
    },
}

module.exports = { createClassChecker, sharedSchema }
