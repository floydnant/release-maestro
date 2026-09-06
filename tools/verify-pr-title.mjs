#!/usr/bin/env node

import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const types = [
    'build',
    'chore',
    'ci',
    'deps',
    'docs',
    'feat',
    'fix',
    'perf',
    'refactor',
    'revert',
    'style',
    'test',
]
const pattern = new RegExp(`^(${types.join('|')})(\\([A-Za-z0-9._/-]+\\))?!?: .*\\S.*$`)

export function isValidPrTitle(title) {
    return !/[\r\n]/.test(title) && pattern.test(title)
}

function main() {
    const title = process.env.TITLE ?? ''
    if (isValidPrTitle(title)) {
        console.log(`ok - ${JSON.stringify(title)}`)
        return
    }

    console.error(
        '::error title=Pull request title is not a Conventional Commit::Expected type(optional-scope)!: description with a non-blank description.',
    )
    console.error(`Got: ${JSON.stringify(title)}`)
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `## Pull request title is not a Conventional Commit

Expected \`type(optional-scope)!: description\` with a non-blank description, for example:

- \`feat(renderer): add history navigation controls\`
- \`fix: keep the scan cursor after a restart\`
- \`refactor(skills)!: rename the review skill\`

Types: ${types.map(type => `\`${type}\``).join(', ')}.

Scope is optional and accepts letters, digits, dots, underscores, slashes, and hyphens. \`!\` marks a breaking change.
`,
        )
    }
    process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
