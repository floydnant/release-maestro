/**
 * The acceptance corpus for design-system class validation.
 *
 * One file, tracking MAE-100's shared corpus case by case: the `R*` ids are its "reject or report
 * unsupported" list, the `A*` ids its "accept" list. Two further ids came out of the head-to-head
 * comparison rather than the original spec — `R7` (a bare utility whose scale has no `DEFAULT` key)
 * and `S1` (suggest the nearest value *in the scale*, not the nearest spelling).
 *
 * Every authority is a fixture inside this library — see `fixtures/tailwind.config.cjs` for why the
 * renderer's own config is deliberately not used here.
 *
 * Run with `npx nx test eslint-plugin-design-system`.
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

const FIXTURES = path.join(__dirname, 'fixtures')

const FIXTURE_TEMPLATE = path.join(FIXTURES, 'specimen.component.html')
const FIXTURE_COMPONENT = path.join(FIXTURES, 'specimen.component.ts')

const TAILWIND_CONFIG = path.join(FIXTURES, 'tailwind.config.cjs')

/**
 * The authorities are addressed absolutely so the corpus does not depend on the directory Jest
 * happens to be launched from.
 */
const authorities = {
    tailwindConfig: TAILWIND_CONFIG,
    globalStylesheets: [path.join(FIXTURES, 'global.css')],
}

const settings = [authorities]
/** The unsupported cases are noisy by default; silencing them isolates the case under test. */
const quiet = [{ ...authorities, reportDynamic: false }]

/** @param {string} className */
const unknown = className => ({ messageId: 'unknownClass', data: { className } })

/**
 * A misspelling: the name is near a real one.
 *
 * @param {string} className
 * @param {string} suggestion
 */
const didYouMean = (className, suggestion) => ({
    messageId: 'unknownClassWithSuggestion',
    data: { className, suggestion },
})

/**
 * A misspelling in the one position a descriptor could also have occupied — first in a pipe-less
 * list. The rule cannot tell the two apart, so it offers both readings as a question.
 *
 * @param {string} className
 * @param {string} [suggestion]
 */
const orDescriptor = (className, suggestion) =>
    suggestion
        ? {
              messageId: 'unknownClassOrDescriptorWithSuggestion',
              data: { className, suggestion },
          }
        : { messageId: 'unknownClassOrDescriptor', data: { className } }

/**
 * A real utility carrying a value this project's scale does not define. Not a misspelling, and the
 * diagnostic must not call it one.
 *
 * @param {string} className
 * @param {string} scale
 * @param {string} suggestion
 */
const offScale = (className, scale, suggestion) => ({
    messageId: 'offScaleValue',
    data: { className, scale, suggestion },
})

/**
 * A real utility with no bare form, because the scale replacing Tailwind's has no `DEFAULT` key.
 *
 * @param {string} className
 * @param {string} suggestion
 */
const bareUtility = (className, suggestion) => ({
    messageId: 'bareUtility',
    data: { className, suggestion },
})

/**
 * A named case against the template fixture. `extra` is intersected into the result rather than
 * widened away, so a case that passes `errors` is an invalid case and one that does not is a valid
 * case — which is exactly what `RuleTester`'s two buckets require.
 *
 * @template {object} T
 * @param {string} name
 * @param {string} code
 * @param {T} [extra]
 * @returns {{ name: string, filename: string, options: unknown[], code: string } & T}
 */
const template = (name, code, extra) => ({
    name,
    filename: FIXTURE_TEMPLATE,
    options: settings,
    code,
    .../** @type {T} */ (extra ?? {}),
})

/**
 * @template {object} T
 * @param {string} name
 * @param {string} code
 * @param {T} [extra]
 * @returns {{ name: string, filename: string, options: unknown[], code: string } & T}
 */
const host = (name, code, extra) => ({
    name,
    filename: FIXTURE_COMPONENT,
    options: settings,
    code,
    .../** @type {T} */ (extra ?? {}),
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
        template(
            'A8 [ngClass] multi-class key',
            '<div [ngClass]="{ \'opacity-30 blur-sm\': hidden }"></div>',
        ),
        template('A8 [class] conditional', "<div [class]=\"cond ? 'flex' : 'hidden'\"></div>"),
        template('A8 routerLinkActive', '<a routerLinkActive="active-link"></a>'),
        template('A8 static ngClass', '<div ngClass="flex gap-2"></div>'),
        template('A10 component-local custom property', '<div class="w-[var(--progress-width)]"></div>'),

        template('non-class attributes are untouched', '<div [style.width]="w" title="flex"></div>'),
        template('reporting stays configurable', '<div [class]="workerHealthClass()"></div>', {
            options: quiet,
        }),

        // --- A9: a closed vocabulary the owning component declares ---
        template('A9 a method whose every branch is a literal', '<div [class]="statusClass(s)"></div>'),
        template('A9 a computed', '<div [class]="badgeClass()"></div>'),
        template('A9 a computed with a concise ternary body', '<div [class]="toneClass()"></div>'),
        template('A9 a constant property, read without a call', '<div [class]="listClass"></div>'),
        template('A9 a getter', '<div [class]="panelClass"></div>'),
        template('A9 among the other surfaces', '<div [ngClass]="badgeClass()"></div>'),
        template(
            // The literal ends in whitespace, so nothing is glued and both parts are whole lists.
            'A9 concatenated onto a literal prefix',
            '<div [class]="\'badge \' + statusClass(s)"></div>',
        ),
        template('A9 inside a conditional', '<div [class]="cond ? badgeClass() : listClass"></div>'),
    ],

    invalid: [
        template('R1 unknown generated class', '<p class="type-code-sl"></p>', {
            errors: [orDescriptor('type-code-sl', 'type-code-sm')],
        }),
        template('R2 unknown ordinary utility', '<div class="fleex"></div>', {
            errors: [orDescriptor('fleex', 'flex')],
        }),
        template('R2 unknown utility with no clear candidate', '<div class="flex bg-nonsense"></div>', {
            errors: [unknown('bg-nonsense')],
        }),
        template(
            'R2 descriptors are exempt, styling classes are not',
            '<div class="sidebar | fleex"></div>',
            {
                errors: [didYouMean('fleex', 'flex')],
            },
        ),
        {
            name: 'R3 component-scoped class outside its own component',
            filename: path.join(FIXTURES, 'other.component.html'),
            options: settings,
            code: '<div class="scoped-only"></div>',
            errors: [orDescriptor('scoped-only')],
        },
        template('R4 empty descriptor', '<div class="| flex"></div>', {
            errors: [{ messageId: 'emptyDescriptor' }],
        }),
        template('R4 multiple descriptors', '<div class="sidebar rail | flex"></div>', {
            errors: [{ messageId: 'multipleDescriptors' }],
        }),
        template('R4 multiple pipes', '<div class="sidebar | flex | bg-slate-600"></div>', {
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
        template(
            'R6 bare foundation token',
            '<div class="text-[var(--foundation-color-neutral-500)]"></div>',
            {
                errors: [
                    { messageId: 'bareTokenVariable', data: { variable: '--foundation-color-neutral-500' } },
                ],
            },
        ),
        template(
            // Tailwind resolves theme paths only at compile time, so this would otherwise be a build
            // error rather than an editor diagnostic.
            'R6 misspelled theme path',
            '<div class="bg-[theme(colors.status.info.background)]"></div>',
            {
                errors: [
                    { messageId: 'unknownThemePath', data: { themePath: 'colors.status.info.background' } },
                ],
            },
        ),
        template('R5 unresolvable call', '<div [class]="workerHealthClass()"></div>', {
            errors: [{ messageId: 'dynamicClassList' }],
        }),
        template('R5 unresolvable map reference', '<div [ngClass]="classMap"></div>', {
            errors: [{ messageId: 'dynamicClassList' }],
        }),
        template(
            // A spread contributes keys that exist only at runtime. The written-out keys beside it
            // are still validated — `fleex` below — so the spread costs nothing but its own name.
            'R5 object spread among [ngClass] keys',
            '<div [ngClass]="{ ...base, \'fleex\': cond }"></div>',
            { errors: [{ messageId: 'dynamicClassList' }, orDescriptor('fleex', 'flex')] },
        ),
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
            // No expression is trusted for its shape. A call that looks like a generated token API
            // is as unresolvable as any other call — the plugin cannot prove what it returns, and
            // an exemption keyed on the *name* of the thing being called proves nothing at all.
            'R5 a call that looks like a generated token API',
            '<div [class]="typographyClass(variant())"></div>',
            { errors: [{ messageId: 'dynamicClassList' }] },
        ),
        template(
            'R5 a property chain rooted in a generated module',
            '<div [ngClass]="typographyVariantIdentifiers[index]"></div>',
            { errors: [{ messageId: 'dynamicClassList' }] },
        ),

        // --- A9's other half: resolving a member is not accepting it ---
        template(
            // The whole reason the answer is the literals rather than the member: a closed
            // vocabulary is only as good as the classes in it.
            'A9 a resolved member carrying an unknown class',
            '<div [class]="plantedClass()"></div>',
            { errors: [didYouMean('fleex', 'flex')] },
        ),
        template('A9 a member with a branch that is not a literal', '<div [class]="mixedClass(x)"></div>', {
            errors: [{ messageId: 'dynamicClassList' }],
        }),
        template(
            // Writable, so the initial value is not what the template renders.
            'A9 a signal is not a closed vocabulary',
            '<div [class]="mutableClass()"></div>',
            { errors: [{ messageId: 'dynamicClassList' }] },
        ),
        template(
            // Declaration kind and call shape have to agree, or the expression is not describing
            // this member.
            'A9 a method read without calling it',
            '<div [class]="statusClass"></div>',
            { errors: [{ messageId: 'dynamicClassList' }] },
        ),
        template('A9 a constant property called like a method', '<div [class]="listClass()"></div>', {
            errors: [{ messageId: 'dynamicClassList' }],
        }),
        template(
            // Nothing can be said about what the rest of the chain does to the resolved value.
            'A9 a chain hanging off a resolved member',
            '<div [class]="badgeClass().length"></div>',
            { errors: [{ messageId: 'dynamicClassList' }] },
        ),
        template(
            // Angular binds `listClass` to the loop item, not to the component's member. The
            // expression AST cannot tell the two apart, so the template's own bindings win.
            'A9 a member shadowed by a name the template binds',
            '@for (listClass of rows; track listClass) { <div [class]="listClass"></div> }',
            { errors: [{ messageId: 'dynamicClassList' }] },
        ),
        {
            // The removed check trusted a root identifier for its spelling. This is that exact
            // shape: a local `computed` that is not Angular's, wrapping a valid class name.
            name: 'A9 a look-alike factory from outside @angular/core',
            filename: path.join(FIXTURES, 'local-computed.component.html'),
            options: settings,
            code: '<div [class]="wrapperClass()"></div>',
            errors: [{ messageId: 'dynamicClassList' }],
        },

        // --- D1: the descriptor reading, offered only where a descriptor could have gone ---
        template(
            'D1 a descriptor that forgot its pipe',
            '<div class="mosaic-cell relative overflow-hidden"></div>',
            { errors: [orDescriptor('mosaic-cell')] },
        ),
        template(
            'D1 not offered once the list already has a descriptor',
            '<div class="sidebar | oops-class"></div>',
            { errors: [unknown('oops-class')] },
        ),
        template('D1 not offered away from the first position', '<div class="flex oops-class"></div>', {
            errors: [unknown('oops-class')],
        }),
        template(
            // A descriptor on `routerLinkActive` could never be right — it names classes to apply,
            // not the element.
            'D1 not offered on routerLinkActive',
            '<a routerLinkActive="oops-class"></a>',
            { errors: [unknown('oops-class')] },
        ),
        template(
            // `rounded` is a real utility name, so "did you invent this?" is the wrong question.
            'D1 never displaces the bare-utility verdict',
            '<div class="rounded flex"></div>',
            { errors: [bareUtility('rounded', 'rounded-sm')] },
        ),

        // --- R7/S1: the two cases the prototype comparison produced ---
        template('R7 bare utility whose scale has no DEFAULT key', '<div class="rounded"></div>', {
            errors: [bareUtility('rounded', 'rounded-sm')],
        }),
        template('R7 bare shadow', '<div class="shadow"></div>', {
            errors: [bareUtility('shadow', 'shadow-sm')],
        }),
        template('S1 scale proximity beats edit distance', '<div class="max-h-72"></div>', {
            errors: [offScale('max-h-72', 'max-h', 'max-h-64')],
        }),

        // --- the same checks across every dynamic surface ---
        template('R2 across [class.foo]', '<div [class.rounded-nope]="$first"></div>', {
            errors: [didYouMean('rounded-nope', 'rounded-none')],
        }),
        template('R2 across [ngClass] keys', '<div [ngClass]="{ \'ml-52 oops-class\': isMacos }"></div>', {
            errors: [unknown('oops-class')],
        }),
        template('R2 across [class] conditionals', "<div [class]=\"cond ? 'flex' : 'hiddenn'\"></div>", {
            errors: [orDescriptor('hiddenn', 'hidden')],
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
        host(
            'A7 host descriptor',
            "@Component({ host: { class: 'progress-ring | inline-block' } }) class C {}",
        ),
        host(
            'non-class host metadata is untouched',
            "@Component({ host: { 'data-testid': 'x' } }) class C {}",
        ),
        host(
            'A8 statically enumerable host class binding',
            "@Component({ host: { '[class.rounded-l-full]': 'isFirst' } }) class C {}",
        ),
        host('reporting stays configurable', '@Component({ host: { class: expr } }) class C {}', {
            options: quiet,
        }),
    ],
    invalid: [
        host(
            'R2 unknown host class',
            "@Component({ host: { class: 'inline-flex nope-class' } }) class C {}",
            {
                errors: [unknown('nope-class')],
            },
        ),
        host(
            'R2 unknown host class on a directive',
            "@Directive({ host: { class: 'block sizee-full' } }) class D {}",
            {
                errors: [didYouMean('sizee-full', 'size-full')],
            },
        ),
        host('R4 multiple host descriptors', "@Component({ host: { class: 'a b | block' } }) class C {}", {
            errors: [{ messageId: 'multipleDescriptors' }],
        }),
        host(
            'R6 bare design token in host metadata',
            "@Component({ host: { class: 'text-[var(--color-content-muted)]' } }) class C {}",
            { errors: [{ messageId: 'bareTokenVariable', data: { variable: '--color-content-muted' } }] },
        ),
        host('R7 bare utility in host metadata', "@Component({ host: { class: 'rounded' } }) class C {}", {
            errors: [bareUtility('rounded', 'rounded-sm')],
        }),
        host(
            // The decorator's `[class.foo]`: the condition is dynamic, the class name never is.
            'R2 unknown class in a host class binding',
            "@Component({ host: { '[class.fleex]': 'isActive' } }) class C {}",
            { errors: [didYouMean('fleex', 'flex')] },
        ),
        host(
            'R2 host class binding on a directive',
            "@Directive({ host: { '[class.sizee-full]': 'x' } }) class D {}",
            { errors: [didYouMean('sizee-full', 'size-full')] },
        ),
        host(
            // Checked alongside the literal list rather than instead of it.
            'R2 a host class binding beside a literal class list',
            "@Component({ host: { '[class.fleex]': 'x', class: 'inline-flex nope-class' } }) class C {}",
            { errors: [didYouMean('fleex', 'flex'), unknown('nope-class')] },
        ),
        host(
            'R5 a host class list built at runtime',
            '@Component({ host: { class: buildClasses() } }) class C {}',
            { errors: [{ messageId: 'dynamicClassList' }] },
        ),
        host(
            'D1 host metadata carries descriptors too',
            "@Component({ host: { class: 'progress-ring inline-block' } }) class C {}",
            { errors: [orDescriptor('progress-ring')] },
        ),
    ],
})

// --- suggestion quality, isolated from ESLint ----------------------------------------------------

describe('S1 nearest-value suggestions in the utility’s own scale', () => {
    const candidates = tailwindClassList(TAILWIND_CONFIG)

    // The values a human reached for when fixing these exact classes in the renderer.
    it.each([
        ['max-h-72', 'max-h-64', 'max-h'],
        ['max-h-44', 'max-h-52', 'max-h'],
        ['min-h-36', 'min-h-32', 'min-h'],
        ['py-14', 'py-12', 'py'],
        ['opacity-80', 'opacity-70', 'opacity'],
    ])('suggests %s → %s, off the %s scale', (unknownClass, expected, scale) => {
        expect(suggestClassName(unknownClass, candidates)).toEqual({
            name: expected,
            kind: 'offScale',
            scale,
        })
    })

    it.each([
        ['rounded', 'rounded-sm'],
        ['shadow', 'shadow-sm'],
    ])('suggests the first real step for bare %s → %s', (unknownClass, expected) => {
        expect(suggestClassName(unknownClass, candidates)).toEqual({
            name: expected,
            kind: 'bareUtility',
        })
    })

    it.each([
        ['fleex', 'flex'],
        ['type-code-sl', 'type-code-sm'],
    ])('still uses edit distance for typos: %s → %s', (unknownClass, expected) => {
        expect(suggestClassName(unknownClass, [...candidates, 'type-code-sm'])).toEqual({
            name: expected,
            kind: 'spelling',
        })
    })

    it('offers nothing when no candidate is close', () => {
        expect(suggestClassName('bg-nonsense', candidates)).toBeNull()
    })
})

// --- the types point at something that is actually installed -------------------------------------

describe('the Angular compiler types', () => {
    /**
     * `types.d.ts` derives the AST shapes from this package. It was previously
     * `@angular-eslint/bundled-angular-compiler`, which npm hoists on some installs and nests under
     * its dependents on others — so the types resolved on a developer machine and not on a clean
     * `npm ci`, and `skipLibCheck` turned that into one baffling error in an unrelated file.
     * `@angular/compiler` is a declared top-level dependency, and this asserts it stays reachable.
     */
    it('name a package resolvable from this library', () => {
        expect(() => require.resolve('@angular/compiler')).not.toThrow()
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
            cwd: __dirname,
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

    /**
     * The rendered text, not just the message id: what a developer reads is the product here, and a
     * message that quietly grows a clause or starts calling a real utility "unknown" is a
     * regression the id-level assertions above cannot see.
     */
    it('reports exactly the specimen’s planted defects, in the words it means to use', async () => {
        const [result] = await lintFixture()

        expect(result.messages.map(message => message.message)).toEqual([
            'Unknown class `type-code-sl` — did you mean `type-code-sm`, or a descriptor missing its `|`?',
            'Bare `rounded` emits no CSS — did you mean `rounded-sm`?',
            'Bare `shadow` emits no CSS — did you mean `shadow-sm`?',
            '`max-h-72` is off the `max-h` scale — did you mean `max-h-64`?',
            '`py-14` is off the `py` scale — did you mean `py-12`?',
        ])
    })

    it('underlines the class token itself, not the whole attribute', async () => {
        const [result] = await lintFixture()
        const [first] = result.messages

        expect((first.endColumn ?? 0) - first.column).toBe('type-code-sl'.length)
    })
})
