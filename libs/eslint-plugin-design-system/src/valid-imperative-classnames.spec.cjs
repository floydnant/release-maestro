const path = require('node:path')
const { RuleTester } = require('eslint')
const typescriptParser = require('@typescript-eslint/parser')
const rule = require('./rules/valid-imperative-classnames.cjs')

const FIXTURES = path.join(__dirname, 'fixtures')
const FIXTURE_COMPONENT = path.join(FIXTURES, 'specimen.component.ts')

const options = [
    {
        tailwindStylesheet: path.join(FIXTURES, 'tailwind.css'),
        globalStylesheets: [path.join(FIXTURES, 'global.css')],
    },
]

const tester = new RuleTester({
    languageOptions: {
        parser: typescriptParser,
        parserOptions: {
            // RuleTester supplies inline source for an existing fixture filename. Keep CI from
            // replacing it with the file on disk through single-run program inference.
            disallowAutomaticSingleRunInference: true,
            project: path.join(FIXTURES, 'tsconfig.json'),
            tsconfigRootDir: FIXTURES,
        },
    },
})

/**
 * @template {object} T
 * @param {string} code
 * @param {T} [extra]
 */
const example = (code, extra) => ({
    filename: FIXTURE_COMPONENT,
    options,
    code,
    .../** @type {T} */ (extra ?? {}),
})

/** @param {string} className @param {string} suggestion */
const didYouMean = (className, suggestion) => ({
    messageId: 'unknownClassWithSuggestion',
    data: { className, suggestion },
})

const fleex = didYouMean('fleex', 'flex')

/** @param {string} code @param {string} token @param {object} error */
const atToken = (code, token, error) => {
    const column = code.lastIndexOf(token) + 1
    return example(code, {
        errors: [
            {
                ...error,
                line: 1,
                column,
                endLine: 1,
                endColumn: column + token.length,
            },
        ],
    })
}

tester.run('valid-imperative-classnames', rule, {
    valid: [
        example("@Component({ host: { class: 'flex' } }) class Example {}"),
        example("class Example { @HostBinding('attr.role') role = 'button' }"),
        example("class Example { @HostBinding() title = 'Title' }"),
        example("class Example { @HostBinding('class.hidden') hidden = true }"),
        example(
            "import { HostBinding as Bind } from '@angular/core'; class Example { @Bind('class.hidden') hidden = true }",
        ),
        example(
            "import * as ng from '@angular/core'; class Example { @ng.HostBinding('class.hidden') hidden = true }",
        ),
        example(
            "class Example { @Bind('class.hidden') hidden = true }; import { HostBinding as Bind } from '@angular/core'",
        ),
        example("class Example { @HostBinding('class') readonly classes: 'flex' | 'hidden' = 'flex' }"),
        example(
            "type Classes = 'flex' | 'hidden'; declare function pick(): Classes; class Example { @HostBinding('className') readonly classes: Classes = pick() }",
        ),
        example("class Example { @HostBinding() readonly className: 'flex' | 'hidden' = 'flex' }"),
        example(
            "import { HostBinding as Bind } from '@angular/core'; class Example { @Bind() readonly className: 'flex' | 'hidden' = 'flex' }",
        ),
        example(
            "import * as ng from '@angular/core'; class Example { @ng.HostBinding() readonly className: 'flex' | 'hidden' = 'flex' }",
        ),
        example("element.classList.add('hidden', 'flex')"),
        example("element.classList.add('scoped-only')"),
        example("element.classList.remove('hidden')"),
        example("element.classList.toggle('hidden')"),
        example("declare const shouldHide: boolean; element.classList.toggle('hidden', shouldHide)"),
        example("element.classList.replace('hidden', 'flex')"),
        example("declare const classes: ('hidden' | 'flex')[]; element.classList.add(...classes)"),
        example(
            "type Classes = 'hidden' | 'flex'; declare function pick(): Classes; element.classList.add(pick())",
        ),
        example(
            "import { Renderer2 } from '@angular/core'; function apply(renderer: Renderer2) { renderer.addClass(element, 'hidden') }",
        ),
        example(
            "import { Renderer2 } from '@angular/core'; type Classes = 'hidden' | 'flex'; declare function pick(): Classes; function apply(renderer: Renderer2) { renderer.addClass(element, pick()) }",
        ),
        example("element.classList.contains('hidden')"),
        example('element.classList.item(0)'),
        example(
            "collection.add('hidden'); collection.remove('hidden'); collection.toggle('hidden'); collection.replace('a', 'b')",
        ),
        example("collection.addClass(element, 'hidden'); collection.removeClass(element, 'hidden')"),
        example("renderer.setAttribute(element, 'role', 'button')"),
        example('const text = \'element.classList.add("fleex")\''),
        example('// element.classList.add("fleex")'),
    ],
    invalid: [
        example("class Example { @HostBinding('class.fleex') active = true }", {
            errors: [fleex],
        }),
        atToken("class Example { @HostBinding('cl\\x61ss.fleex') active = true }", 'fleex', fleex),
        example(
            "import { HostBinding as Bind } from '@angular/core'; class Example { @Bind('class.fleex') active = true }",
            { errors: [fleex] },
        ),
        example(
            "import * as ng from '@angular/core'; class Example { @ng.HostBinding('class.fleex') active = true }",
            { errors: [fleex] },
        ),
        example("class Example { @HostBinding('class') readonly classes: 'flex' | 'fleex' = 'flex' }", {
            errors: [fleex],
        }),
        example(
            "declare function pick(): string; class Example { @HostBinding('className') classes = pick() }",
            {
                errors: [{ messageId: 'dynamicClass', data: { type: 'string' } }],
            },
        ),
        example('declare function pick(): string; class Example { @HostBinding() className = pick() }', {
            errors: [{ messageId: 'dynamicClass', data: { type: 'string' } }],
        }),
        ...['add', 'remove', 'toggle'].map(method => {
            const code = `element.classList.${method}('fleex')`
            return atToken(code, 'fleex', fleex)
        }),
        example("element.classList.replace('hidden', 'fleex')", { errors: [fleex] }),
        example("declare const classes: ('hidden' | 'fleex')[]; element.classList.add(...classes)", {
            errors: [fleex],
        }),
        example('declare const classes: string[]; element.classList.add(...classes)', {
            errors: [{ messageId: 'dynamicClass', data: { type: 'string' } }],
        }),
        atToken("element.classList.add('fl\\x65ex')", 'fl\\x65ex', fleex),
        example(
            "type Classes = 'hidden' | 'fleex'; declare function pick(): Classes; element.classList.add(pick())",
            { errors: [fleex] },
        ),
        example('declare function pick(): string; element.classList.add(pick())', {
            errors: [{ messageId: 'dynamicClass', data: { type: 'string' } }],
        }),
        example(
            "import { Renderer2 } from '@angular/core'; class Example { constructor(private renderer: Renderer2) {} apply() { this.renderer.addClass(element, 'fleex') } }",
            { errors: [fleex] },
        ),
        example(
            "import { Renderer2 } from '@angular/core'; type Classes = 'hidden' | 'fleex'; declare function pick(): Classes; function apply(renderer: Renderer2) { const alias = renderer; alias.removeClass(element, pick()) }",
            { errors: [fleex] },
        ),
        example(
            "import { Renderer2 as DomRenderer } from '@angular/core'; declare function pick(): string; function apply(renderer: DomRenderer) { renderer.removeClass(element, pick()) }",
            { errors: [{ messageId: 'dynamicClass', data: { type: 'string' } }] },
        ),
        example(
            "import * as ng from '@angular/core'; class Example { private renderer: ng.Renderer2; apply() { this.renderer.addClass(element, 'fleex') } }",
            { errors: [fleex] },
        ),
        example(
            "import { inject, Renderer2 } from '@angular/core'; class Example { private renderer = inject(Renderer2); apply() { this.renderer.addClass(element, 'fleex') } }",
            { errors: [fleex] },
        ),
        example("element['classList']['add']('fleex')", { errors: [fleex] }),
        example('element[`classList`][`remove`](`fleex`)', { errors: [fleex] }),
        example("element?.classList?.toggle('fleex')", { errors: [fleex] }),
        example(
            "import { Renderer2 } from '@angular/core'; function apply(renderer: Renderer2) { renderer?.['removeClass']?.(element, 'fleex') }",
            { errors: [fleex] },
        ),
        example("getElement().classList.add('fleex')", { errors: [fleex] }),
    ],
})

describe('renderer registration', () => {
    it('limits the rule to src/app from both the workspace and project working directories', () => {
        // ESLint imports the .mjs config. Run outside Jest's CommonJS VM so this exercises the
        // actual config without changing every plugin test to experimental VM modules.
        const { execFileSync } = require('node:child_process')
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
                        assert.equal(config?.rules['design-system/valid-imperative-classnames']?.[0] === 2, enabled, file);
                    }
                }
            })().catch(error => { console.error(error); process.exitCode = 1; });
        `,
            ],
            { cwd: workspace, stdio: 'pipe' },
        )
    })
})
