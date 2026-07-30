/**
 * Combines the two authorities — Tailwind's resolver and the authored stylesheets — into one
 * question: would this class name produce any CSS in this app?
 */
const path = require('node:path')
const { classesFromCssFile, componentClassesForTemplate } = require('./css-classes.cjs')
const { isTailwindClass } = require('./tailwind-authority.cjs')

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

    const globalClasses = new Set()
    for (const sheet of globalStylesheets) {
        for (const className of classesFromCssFile(sheet)) globalClasses.add(className)
    }

    const localClasses = filePath ? componentClassesForTemplate(filePath) : new Set()

    return className =>
        globalClasses.has(className) ||
        localClasses.has(className) ||
        isTailwindClass(tailwindConfig, className)
}

const sharedSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        tailwindConfig: { type: 'string' },
        globalStylesheets: { type: 'array', items: { type: 'string' } },
        reportDynamic: { type: 'boolean' },
    },
}

module.exports = { createClassChecker, sharedSchema }
