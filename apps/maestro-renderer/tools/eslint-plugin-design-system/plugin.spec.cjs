/**
 * The acceptance corpus for design-system class validation.
 *
 * One file, tracking MAE-100's shared corpus case by case: the `R*` ids are its "reject or report
 * unsupported" list, the `A*` ids its "accept" list. Two further ids came out of the head-to-head
 * comparison rather than the original spec — `R7` (a bare utility whose scale has no `DEFAULT` key)
 * and `S1` (suggest the nearest value *in the scale*, not the nearest spelling).
 *
 * Run with `npx nx run maestro-renderer:tooling-test`.
 */
const path = require('node:path')
const { ESLint, RuleTester } = require('eslint')
const templateParser = require('@angular-eslint/template-parser')
const typescriptParser = require('@typescript-eslint/parser')

const plugin = require('./index.cjs')
const templateRule = require('./rules/valid-template-classnames.cjs')
const hostRule = require('./rules/valid-host-classnames.cjs')
const { suggestClassName } = require('./lib/suggest.cjs')
const { readComponentMetadata } = require('./lib/component-metadata.cjs')
const { tailwindClassList } = require('./lib/tailwind-authority.cjs')

const RENDERER = path.resolve(__dirname, '../..')
const FIXTURES = path.join(__dirname, 'fixtures')

const FIXTURE_TEMPLATE = path.join(FIXTURES, 'specimen.component.html')
const FIXTURE_COMPONENT = path.join(FIXTURES, 'specimen.component.ts')
const FIXTURE_TOKEN_API = path.join(FIXTURES, 'design-tokens.generated.fixture.ts')

const TAILWIND_CONFIG = path.join(RENDERER, 'tailwind.config.js')

/**
 * The authorities are addressed absolutely so the corpus does not depend on the directory Jest
 * happens to be launched from.
 */
const authorities = {
    tailwindConfig: TAILWIND_CONFIG,
    globalStylesheets: [path.join(RENDERER, 'src/styles.css')],
    generatedTokenApi: path.join(RENDERER, 'src/app/shared/design-tokens.generated.ts'),
}

const settings = [authorities]
/** The unsupported cases are noisy by default; silencing them isolates the case under test. */
const quiet = [{ ...authorities, reportDynamic: false }]
/** Points the typed-API authority at the fixture module — see its header for why. */
const withFixtureTokenApi = [{ ...authorities, generatedTokenApi: FIXTURE_TOKEN_API }]

const unknown = className => ({ messageId: 'unknownClass', data: { className } })
const didYouMean = (className, suggestion) => ({
    messageId: 'unknownClassWithSuggestion',
    data: { className, suggestion },
})

const template = (name, code, extra = {}) => ({
    name,
    filename: FIXTURE_TEMPLATE,
    options: settings,
    code,
    ...extra,
})
const host = (name, code, extra = {}) => ({
    name,
    filename: FIXTURE_COMPONENT,
    options: settings,
    code,
    ...extra,
})

// --- the two ESLint rules against the corpus -----------------------------------------------------

const templateTester = new RuleTester({ languageOptions: { parser: templateParser } })

templateTester.run('valid-template-classnames', templateRule, {
    valid: [
        template('A1 valid utilities', '<div class="flex items-center gap-3"></div>'),
        template(
            'A1 modifiers and variants',
            '<div class="hover:bg-background-surface group-hover:opacity-100 @lg:flex"></div>',
        ),
        template('A1 variant markers', '<div class="group peer group/row"></div>'),
        template('A1 plugin utilities', '<div class="glass wrap-nicely child-focus-ring"></div>'),
        template(
            'A2 arbitrary layout values',
            '<div class="w-[130px] bg-[color-mix(in_srgb,white_40%,transparent)]"></div>',
        ),
        template(
            'A2 design token reached through the theme',
            '<div class="bg-[color-mix(in_srgb,theme(colors.background.surface)_40%,transparent)]"></div>',
        ),
        template('A2 theme path', '<div class="bg-[theme(colors.status.info-background)]"></div>'),
        template('A3 generated typography classes', '<div class="type-body-sm type-code-sm"></div>'),
        template('A4 global authored classes', '<div class="btn-nkd-neutral badge panel"></div>'),
        template(
            'A5 owning component scoped CSS, linked and inline',
            '<div class="scoped-only nested-scoped inline-scoped"></div>',
        ),
        template('A6 static list with no descriptor', '<div class="flex items-center"></div>'),
        template(
            'A7 exactly one descriptor',
            '<div class="title-bar__drag-region | flex items-center"></div>',
        ),
        template('A8 [class.foo]', '<div [class.rounded-l-full]="$first"></div>'),
        template('A8 [ngClass] object keys', '<div [ngClass]="{ \'ml-52\': isMacos }"></div>'),
        template('A8 [ngClass] multi-class key', '<div [ngClass]="{ \'opacity-30 blur-sm\': hidden }"></div>'),
        template('A8 [class] conditional', "<div [class]=\"cond ? 'flex' : 'hidden'\"></div>"),
        template('A8 routerLinkActive', '<a routerLinkActive="active-link"></a>'),
        template('A8 static ngClass', '<div ngClass="flex gap-2"></div>'),
        template('A9 typed generated API', '<div [class]="typographyClass(variant())"></div>', {
            options: withFixtureTokenApi,
        }),
        template(
            'A9 typed generated API behind a property chain',
            '<div [ngClass]="typographyVariantIdentifiers[index]"></div>',
            { options: withFixtureTokenApi },
        ),
        template('A10 component-local custom property', '<div class="w-[var(--progress-width)]"></div>'),

        template('non-class attributes are untouched', '<div [style.width]="w" title="flex"></div>'),
        template('reporting stays configurable', '<div [class]="workerHealthClass()"></div>', {
            options: quiet,
        }),
    ],

    invalid: [
        template('R1 unknown generated class', '<p class="type-code-sl"></p>', {
            errors: [didYouMean('type-code-sl', 'type-code-sm')],
        }),
        template('R2 unknown ordinary utility', '<div class="fleex"></div>', {
            errors: [didYouMean('fleex', 'flex')],
        }),
        template('R2 unknown utility with no clear candidate', '<div class="flex bg-nonsense"></div>', {
            errors: [unknown('bg-nonsense')],
        }),
        template('R2 descriptors are exempt, styling classes are not', '<div class="sidebar | fleex"></div>', {
            errors: [didYouMean('fleex', 'flex')],
        }),
        {
            name: 'R3 component-scoped class outside its own component',
            filename: path.join(FIXTURES, 'other.component.html'),
            options: settings,
            code: '<div class="scoped-only"></div>',
            errors: [unknown('scoped-only')],
        },
        template('R4 empty descriptor', '<div class="| flex"></div>', {
            errors: [{ messageId: 'emptyDescriptor' }],
        }),
        template('R4 multiple descriptors', '<div class="sidebar rail | flex"></div>', {
            errors: [{ messageId: 'multipleDescriptors' }],
        }),
        template('R4 multiple pipes', '<div class="sidebar | flex | hidden"></div>', {
            errors: [{ messageId: 'multiplePipes' }],
        }),
        template(
            'R6 bare design token inside an arbitrary value',
            '<div class="bg-[color-mix(in_srgb,var(--color-background-surface)_40%,transparent)]"></div>',
            {
                errors: [
                    { messageId: 'bareTokenVariable', data: { variable: '--color-background-surface' } },
                ],
            },
        ),
        template('R6 bare foundation token', '<div class="text-[var(--foundation-color-neutral-500)]"></div>', {
            errors: [
                { messageId: 'bareTokenVariable', data: { variable: '--foundation-color-neutral-500' } },
            ],
        }),
        template(
            // Tailwind resolves theme paths only at compile time, so this would otherwise be a build
            // error rather than an editor diagnostic.
            'R6 misspelled theme path',
            '<div class="bg-[theme(colors.status.info.background)]"></div>',
            { errors: [{ messageId: 'unknownThemePath', data: { themePath: 'colors.status.info.background' } }] },
        ),
        template('R5 unresolvable call', '<div [class]="workerHealthClass()"></div>', {
            errors: [{ messageId: 'dynamicClassList' }],
        }),
        template('R5 unresolvable map reference', '<div [ngClass]="classMap"></div>', {
            errors: [{ messageId: 'dynamicClassList' }],
        }),
        template('R5 runtime-built prefix', '<div [ngClass]="\'type-\' + token"></div>', {
            errors: [
                { messageId: 'dynamicClassList' },
                { messageId: 'partialClass', data: { className: 'type-' } },
            ],
        }),
        template(
            // The known fragment is still validated; only the fragment touching the runtime value is not.
            'R5 known fragment beside a runtime one',
            '<div [class]="\'badge borderx \' + workerHealthClass()"></div>',
            { errors: [{ messageId: 'dynamicClassList' }, unknown('borderx')] },
        ),
        template('R5 interpolated class list', '<div class="{{ dynamicClass }}"></div>', {
            errors: [{ messageId: 'dynamicClassList' }],
        }),
        template(
            'R5 a call rooted outside the generated module is still unresolvable',
            '<div [class]="componentHelper(variant())"></div>',
            { options: withFixtureTokenApi, errors: [{ messageId: 'dynamicClassList' }] },
        ),

        // --- R7/S1: the two cases the prototype comparison produced ---
        template('R7 bare utility whose scale has no DEFAULT key', '<div class="rounded"></div>', {
            errors: [didYouMean('rounded', 'rounded-sm')],
        }),
        template('R7 bare shadow', '<div class="shadow"></div>', {
            errors: [didYouMean('shadow', 'shadow-sm')],
        }),
        template('S1 scale proximity beats edit distance', '<div class="max-h-72"></div>', {
            errors: [didYouMean('max-h-72', 'max-h-64')],
        }),

        // --- the same checks across every dynamic surface ---
        template('R2 across [class.foo]', '<div [class.rounded-nope]="$first"></div>', {
            errors: [didYouMean('rounded-nope', 'rounded-none')],
        }),
        template('R2 across [ngClass] keys', '<div [ngClass]="{ \'ml-52 oops-class\': isMacos }"></div>', {
            errors: [unknown('oops-class')],
        }),
        template('R2 across [class] conditionals', "<div [class]=\"cond ? 'flex' : 'hiddenn'\"></div>", {
            errors: [didYouMean('hiddenn', 'hidden')],
        }),
        template('R2 across routerLinkActive', '<a routerLinkActive="active-linkk"></a>', {
            errors: [didYouMean('active-linkk', 'active-link')],
        }),
    ],
})

const typescriptTester = new RuleTester({ languageOptions: { parser: typescriptParser } })

typescriptTester.run('valid-host-classnames', hostRule, {
    valid: [
        host(
            'A5 host classes, including the component’s own scoped CSS',
            "@Component({ host: { class: 'inline-flex items-center scoped-only' } }) class C {}",
        ),
        host('A7 host descriptor', "@Component({ host: { class: 'progress-ring | inline-block' } }) class C {}"),
        host('non-class host metadata is untouched', "@Component({ host: { 'data-testid': 'x' } }) class C {}"),
        host('non-literal host class', '@Component({ host: { class: someExpression } }) class C {}'),
    ],
    invalid: [
        host('R2 unknown host class', "@Component({ host: { class: 'inline-flex nope-class' } }) class C {}", {
            errors: [unknown('nope-class')],
        }),
        host('R2 unknown host class on a directive', "@Directive({ host: { class: 'block sizee-full' } }) class D {}", {
            errors: [didYouMean('sizee-full', 'size-full')],
        }),
        host('R4 multiple host descriptors', "@Component({ host: { class: 'a b | block' } }) class C {}", {
            errors: [{ messageId: 'multipleDescriptors' }],
        }),
        host(
            'R6 bare design token in host metadata',
            "@Component({ host: { class: 'text-[var(--color-content-muted)]' } }) class C {}",
            { errors: [{ messageId: 'bareTokenVariable', data: { variable: '--color-content-muted' } }] },
        ),
        host('R7 bare utility in host metadata', "@Component({ host: { class: 'rounded' } }) class C {}", {
            errors: [didYouMean('rounded', 'rounded-sm')],
        }),
    ],
})

// --- suggestion quality, isolated from ESLint ----------------------------------------------------

describe('S1 nearest-value suggestions in the utility’s own scale', () => {
    const candidates = tailwindClassList(TAILWIND_CONFIG)

    // The values a human reached for when fixing these exact classes in the renderer.
    it.each([
        ['max-h-72', 'max-h-64'],
        ['max-h-44', 'max-h-52'],
        ['min-h-36', 'min-h-32'],
        ['py-14', 'py-12'],
        ['opacity-80', 'opacity-70'],
        ['rounded', 'rounded-sm'],
        ['shadow', 'shadow-sm'],
    ])('suggests %s → %s', (unknownClass, expected) => {
        expect(suggestClassName(unknownClass, candidates)).toBe(expected)
    })

    it.each([
        ['fleex', 'flex'],
        ['type-code-sl', 'type-code-sm'],
    ])('still uses edit distance for typos: %s → %s', (unknownClass, expected) => {
        expect(suggestClassName(unknownClass, [...candidates, 'type-code-sm'])).toBe(expected)
    })

    it('offers nothing when no candidate is close', () => {
        expect(suggestClassName('bg-nonsense', candidates)).toBeNull()
    })
})

// --- component metadata is read from the AST, not guessed at -------------------------------------

describe('component metadata resolution', () => {
    it('resolves styleUrls and inline styles through the TypeScript AST', () => {
        const metadata = readComponentMetadata(FIXTURE_COMPONENT)

        expect(metadata.styleUrls).toEqual(['./specimen.component.css'])
        expect(metadata.templateUrls).toEqual(['./specimen.component.html'])
        expect(metadata.inlineStyles.join('')).toContain('.inline-scoped')
    })
})

// --- the whole plugin over a real file on disk ---------------------------------------------------

describe('the committed specimen fixture', () => {
    /** Lints the fixture the way the renderer's own config does, rather than through RuleTester. */
    const lintFixture = () =>
        new ESLint({
            cwd: RENDERER,
            overrideConfigFile: true,
            overrideConfig: [
                {
                    files: ['**/*.html'],
                    languageOptions: { parser: templateParser },
                    plugins: { 'design-system': plugin },
                    rules: { 'design-system/valid-template-classnames': ['error', authorities] },
                },
            ],
        }).lintFiles([FIXTURE_TEMPLATE])

    it('reports exactly the specimen’s planted defects, each with the scale-aware suggestion', async () => {
        const [result] = await lintFixture()

        expect(
            result.messages.map(message => `${message.line}:${message.column} ${message.message}`),
        ).toEqual([
            expect.stringContaining('`type-code-sl` produces no CSS'),
            expect.stringContaining('`rounded` produces no CSS'),
            expect.stringContaining('`shadow` produces no CSS'),
            expect.stringContaining('`max-h-72` produces no CSS'),
            expect.stringContaining('`py-14` produces no CSS'),
        ])

        expect(result.messages.map(message => message.message.match(/Did you mean `(.+?)`/)?.[1])).toEqual([
            'type-code-sm',
            'rounded-sm',
            'shadow-sm',
            'max-h-64',
            'py-12',
        ])
    })

    it('underlines the class token itself, not the whole attribute', async () => {
        const [result] = await lintFixture()
        const [first] = result.messages

        expect(first.endColumn - first.column).toBe('type-code-sl'.length)
    })
})
