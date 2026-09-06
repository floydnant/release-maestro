import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

export const skill = '---\nname: example\ndescription: Example skill\n---\n\nReview the work.\n'
export const sidecar =
    'interface:\n  display_name: Example\n  short_description: Example skill\npolicy:\n  allow_implicit_invocation: true\n'

export function fixture({ divergent = false, skillsDir = '.claude/skills' } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'agent-harness-'))
    const write = (path, text) => {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), text)
    }
    write('.agents/skills/example/SKILL.md', skill)
    write('.agents/skills/example/agents/openai.yaml', sidecar)
    write(
        '.agents/harness-overrides.json',
        JSON.stringify({ harnesses: { claude: { skillsDir, diverge: divergent ? ['example'] : [] } } }),
    )
    const adapter = `${skillsDir}/example`
    mkdirSync(join(root, skillsDir), { recursive: true })
    if (divergent) write(`${adapter}/SKILL.md`, skill)
    else
        symlinkSync(
            relative(join(root, skillsDir), join(root, '.agents/skills/example')),
            join(root, adapter),
        )
    return { root, write, adapter }
}
