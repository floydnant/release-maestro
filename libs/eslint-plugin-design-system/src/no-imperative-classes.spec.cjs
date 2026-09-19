const { RuleTester } = require('eslint')
const typescriptParser = require('@typescript-eslint/parser')
const rule = require('./rules/no-imperative-classes.cjs')

const tester = new RuleTester({ languageOptions: { parser: typescriptParser } })

/**
 * @param {string} code
 * @param {string} token
 * @param {'mutation' | 'hostBinding'} [messageId]
 */
function rejected(code, token, messageId = 'mutation') {
    const column = code.lastIndexOf(token) + 1
    return { code, errors: [{ messageId, line: 1, column, endLine: 1, endColumn: column + token.length }] }
}

tester.run('no-imperative-classes', rule, {
    valid: [
        "@Component({ host: { class: 'flex', '[class.hidden]': 'hidden' }, template: '<div [class.hidden]=\"hidden\"></div>' }) class Example {}",
        "class Example { @HostBinding('attr.role') role = 'button' }",
        'class Example { @HostBinding() title = "Title" }',
        "element.classList.contains('hidden')",
        'element.classList.item(0)',
        "collection.add('hidden'); collection.remove('hidden'); collection.toggle('hidden'); collection.replace('a', 'b')",
        "renderer.setAttribute(element, 'role', 'button')",
        'const text = \'element.classList.add("hidden")\'',
        '// element.classList.add("hidden")',
        "// eslint-disable-next-line rule-to-test/no-imperative-classes -- Remove a class applied by a third-party widget.\nelement.classList.remove('widget-loading')",
    ],
    invalid: [
        rejected("class Example { @HostBinding('className') name = '' }", "'className'", 'hostBinding'),
        rejected(
            "import { HostBinding as Bind } from '@angular/core'; class Example { @Bind('className') classes = '' }",
            "'className'",
            'hostBinding',
        ),
        rejected(
            "import * as ng from '@angular/core'; class Example { @ng.HostBinding('className') classes = '' }",
            "'className'",
            'hostBinding',
        ),
        rejected("class Example { @HostBinding('class') classes = '' }", "'class'", 'hostBinding'),
        rejected(
            "class Example { @HostBinding('class.hidden') hidden = true }",
            "'class.hidden'",
            'hostBinding',
        ),
        rejected(
            'class Example { @HostBinding(`class.hidden`) hidden = true }',
            '`class.hidden`',
            'hostBinding',
        ),
        rejected(
            "import { HostBinding as Bind } from '@angular/core'; class Example { @Bind('class.hidden') hidden = true }",
            "'class.hidden'",
            'hostBinding',
        ),
        rejected(
            "import * as ng from '@angular/core'; class Example { @ng.HostBinding('class.hidden') hidden = true }",
            "'class.hidden'",
            'hostBinding',
        ),
        rejected(
            "class Example { @Bind('class.hidden') hidden = true }; import { HostBinding as Bind } from '@angular/core'",
            "'class.hidden'",
            'hostBinding',
        ),
        ...['add', 'remove', 'toggle', 'replace'].map(method =>
            rejected(`element.classList.${method}('hidden')`, method),
        ),
        ...['addClass', 'removeClass'].map(method =>
            rejected(`this.renderer.${method}(element, 'hidden')`, method),
        ),
        rejected("const alias = renderer; alias.addClass(element, 'hidden')", 'addClass'),
        rejected("element['classList']['add']('hidden')", "'add'"),
        rejected('element[`classList`][`remove`](`hidden`)', '`remove`'),
        rejected("element?.classList?.toggle('hidden')", 'toggle'),
        rejected("renderer?.['removeClass']?.(element, 'hidden')", "'removeClass'"),
        rejected("getElement().classList.add('hidden')", 'add'),
    ],
})

describe('renderer registration', () => {
    it('limits the rule to src/app from both the workspace and project working directories', () => {
        // ESLint imports the .mjs config. Run outside Jest's CommonJS VM so this exercises the
        // actual config without changing every plugin test to experimental VM modules.
        const { execFileSync } = require('node:child_process')
        const path = require('node:path')
        const workspace = path.resolve(__dirname, '../../..')
        execFileSync(
            process.execPath,
            [
                '-e',
                `
            const assert = require('node:assert/strict');
            const path = require('node:path');
            const { ESLint } = require('eslint');
            (async () => {
                const renderer = path.resolve('apps/maestro-renderer');
                for (const cwd of [process.cwd(), renderer]) {
                    const eslint = new ESLint({ cwd, overrideConfigFile: path.join(renderer, 'eslint.config.mjs') });
                    for (const [file, enabled] of [
                        ['src/app/shared/example.ts', true],
                        ['src/app/shared/example.spec.ts', true],
                        ['src/main.ts', false],
                        ['src/vendor/example.ts', false],
                        ['tools/example.ts', false],
                        ['../../libs/example.ts', false],
                    ]) {
                        const config = await eslint.calculateConfigForFile(path.join(renderer, file));
                        assert.equal(config?.rules['design-system/no-imperative-classes']?.[0] === 2, enabled, file);
                    }
                }
            })().catch(error => { console.error(error); process.exitCode = 1; });
        `,
            ],
            { cwd: workspace, stdio: 'pipe' },
        )
    })
})
