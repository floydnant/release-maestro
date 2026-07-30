'use strict'

/**
 * PROTOTYPE (MAE-105) — acceptance corpus for
 * `tailwindcss-angular/no-custom-classname`.
 *
 * Run: `make prototype-classname-test` (from the repository root).
 *
 * Case ids follow the MAE-100 shared acceptance corpus:
 *
 *   R1-R6  the "reject or explicitly report unsupported" list
 *   A1-A10 the "accept" list
 *   S1-S6  the Angular class-producing surfaces MAE-100 enumerates
 *   U1-U4  surfaces this approach cannot reach — recorded as UNSUPPORTED, not
 *          as passes
 *
 * A case that lives in `valid` under a `U*` id is not evidence of correct
 * behaviour; it documents silence. See the report for the pass/fail/unsupported
 * table.
 */

const { RuleTester } = require('eslint')
const templateParser = require('@angular-eslint/template-parser')
const tsParser = require('@typescript-eslint/parser')
const { join } = require('node:path')

const rule = require('./no-custom-classname.cjs')

const workspaceRoot = join(__dirname, '../../..')
const fixtures = join(__dirname, '__fixtures__')

// Mirrors eslint.config.mjs: genuinely global stylesheets only. Component CSS
// is resolved per file by the rule itself.
const options = [
    {
        config: join(workspaceRoot, 'apps/maestro-renderer/tailwind.config.js'),
        cssFiles: ['apps/maestro-renderer/src/styles.css', 'apps/maestro-renderer/src/styles/**/*.css'],
    },
]

const unknown = classname => ({ messageId: 'customClassnameDetected', data: { classname } })
// `suggestions: 1` asserts the editor offers exactly one manual fix — MAE-100
// wants a suggestion, never an automatic correction.
const suggested = (classname, suggestion, suggestions = 1) => ({
    messageId: 'customClassnameWithSuggestion',
    data: { classname, suggestion },
    suggestions,
})

const ownerTemplate = join(fixtures, 'owner.component.html')
const strangerTemplate = join(fixtures, 'stranger.component.html')
const inlineStylesTemplate = join(fixtures, 'inline-styles.component.html')

// Surfaces which case failed; the default handler swallows the name.
RuleTester.it = (name, fn) => {
    try {
        fn()
    } catch (error) {
        error.message = `[${name}] ${error.message}`
        throw error
    }
}

const templateTester = new RuleTester({ languageOptions: { parser: templateParser } })
const scriptTester = new RuleTester({
    languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
})

templateTester.run('no-custom-classname (template)', rule, {
    valid: [
        // -- MAE-100 "accept" list ------------------------------------------
        {
            name: 'A1 valid Tailwind utilities, modifiers and variants',
            code: '<div class="flex items-center hover:bg-background-elevated sm:gap-2 @lg:flex-row"></div>',
            options,
        },
        {
            name: 'A2 valid arbitrary layout values',
            code: '<div class="h-[130px] max-h-[45vh] grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]"></div>',
            options,
        },
        {
            name: 'A3 generated typography classes',
            code: '<div class="type-code-sm type-body-sm"></div>',
            options,
        },
        {
            name: 'A4 real global authored classes',
            code: '<div class="btn btn-primary badge panel surface-elevated"></div>',
            options,
        },
        {
            name: 'A5 real classes from the owning component scoped CSS',
            filename: ownerTemplate,
            code: '<div class="owner-scoped-thing flex"></div>',
            options,
        },
        {
            name: 'A5b owning component inline styles: literal',
            filename: inlineStylesTemplate,
            code: '<div class="inline-scoped-thing flex"></div>',
            options,
        },
        {
            name: 'A6 static class list with no descriptor and no pipe',
            code: '<div class="flex w-52 gap-2"></div>',
            options,
        },
        {
            name: 'A7 exactly one optional descriptor before the pipe',
            code: '<div class="feed-entry | flex p-4"></div>',
            options,
        },
        {
            name: 'A7b descriptor with an empty styling half',
            code: '<div class="favicon |"></div>',
            options,
        },
        {
            name: 'A8 statically enumerable conditional classes in bindings',
            code: `<div [ngClass]="{ 'bg-status-success-background': ok, 'chip | rounded-full px-2': always }" [class]="active ? 'font-bold' : 'font-normal'"></div>`,
            options,
        },
        {
            name: 'A10 component-local custom properties in arbitrary values',
            code: '<div class="max-h-[var(--max-feed-item-height)] text-[color:var(--progress-color)]"></div>',
            options,
        },

        // -- Angular class-producing surfaces (accepting halves) -------------
        {
            name: 'S1 literal class',
            code: '<div class="rounded-xl border border-border-default"></div>',
            options,
        },
        { name: 'S2 [class.foo]', code: '<div [class.rounded-l-full]="first"></div>', options },
        { name: 'S3 resolvable [class]', code: `<div [class]="'flex gap-2'"></div>`, options },
        {
            name: 'S3b [attr.class] sets the same attribute',
            code: `<div [attr.class]="'flex gap-2'"></div>`,
            options,
        },
        {
            name: 'S4 resolvable [ngClass] with enumerable object keys',
            code: `<div [ngClass]="{ 'opacity-50': disabled }"></div>`,
            options,
        },
        {
            name: 'S5 routerLinkActive, static and bound',
            code: `<a routerLinkActive="bg-background-elevated" [routerLinkActive]="'font-bold'"></a>`,
            options,
        },

        // -- Explicit non-goals ---------------------------------------------
        {
            name: 'A10b group/peer names stay valid',
            code: '<div class="group/item peer/toggle group-hover/item:opacity-100"></div>',
            options,
        },
    ],

    invalid: [
        // -- MAE-100 "reject" list ------------------------------------------
        {
            name: 'R1 unknown generated class, with nearest-name suggestion',
            code: '<div class="type-code-sl"></div>',
            options,
            errors: [{ ...suggested('type-code-sl', 'type-code-sm'), line: 1, column: 13, endColumn: 25 }],
        },
        {
            name: 'R2 unknown ordinary utility, with nearest-name suggestion',
            code: '<div class="fleex"></div>',
            options,
            errors: [{ ...suggested('fleex', 'flex'), line: 1, column: 13, endColumn: 18 }],
        },
        {
            name: 'R2b unknown class with no clear candidate keeps the plain message',
            code: '<div class="totally-made-up-thing"></div>',
            options,
            errors: [unknown('totally-made-up-thing')],
        },
        {
            name: 'R3 authored class absent from the owning component and global CSS',
            filename: strangerTemplate,
            code: '<div class="owner-scoped-thing"></div>',
            options,
            errors: [unknown('owner-scoped-thing')],
        },
        {
            name: 'R3b another component scoped class does not leak into this one',
            filename: strangerTemplate,
            code: '<div class="inline-scoped-thing"></div>',
            options,
            errors: [unknown('inline-scoped-thing')],
        },
        {
            name: 'R4 empty descriptor before the pipe',
            code: '<div class="| flex"></div>',
            options,
            errors: [{ messageId: 'emptyDescriptor', line: 1, column: 13, endColumn: 14 }],
        },
        {
            name: 'R4b multiple descriptors before the pipe',
            code: '<div class="card featured | flex"></div>',
            options,
            errors: [{ messageId: 'multipleDescriptors' }],
        },
        {
            name: 'R4c more than one pipe',
            code: '<div class="card | flex | p-4"></div>',
            options,
            errors: [{ messageId: 'multiplePipes' }],
        },
        {
            name: 'R4d pipe glued to a class',
            code: '<div class="card |flex"></div>',
            options,
            errors: [{ messageId: 'notSeparated' }],
        },
        {
            name: 'R4e malformed pipe syntax inside an [ngClass] key',
            code: `<div [ngClass]="{ '| flex': cond }"></div>`,
            options,
            errors: [{ messageId: 'emptyDescriptor' }],
        },
        {
            name: 'R5 unresolved dynamic class construction',
            code: `<div [class]="'type-' + token"></div>`,
            options,
            errors: [{ messageId: 'unresolvedClassName' }],
        },
        {
            // MAE-100 wants typed/generated APIs accepted, but a lint rule cannot
            // tell `typographyClass(token)` from any other call. UNSUPPORTED: the
            // documented escape hatch is a narrow suppression, verified on the
            // real renderer (design-system and debug components).
            name: 'A9 UNSUPPORTED: typed/generated API is indistinguishable from any call',
            code: `<div [class]="typographyClass(token)"></div>`,
            options,
            errors: [{ messageId: 'unresolvedClassName' }],
        },
        {
            name: 'R5b fully opaque [class] binding is not a bypass',
            code: `<div [class]="computedClasses()"></div>`,
            options,
            errors: [{ messageId: 'unresolvedClassName' }],
        },
        {
            name: 'R5c opaque [ngClass] expression is not a bypass',
            code: `<div [ngClass]="classMap()"></div>`,
            options,
            errors: [{ messageId: 'unresolvedClassName' }],
        },
        {
            name: 'R6 bare design-token variable in a Tailwind arbitrary value',
            code: '<div class="bg-[color-mix(in_srgb,var(--color-background-surface)_40%,transparent)]"></div>',
            options,
            errors: [
                {
                    messageId: 'bareDesignTokenVariable',
                    data: {
                        classname:
                            'bg-[color-mix(in_srgb,var(--color-background-surface)_40%,transparent)]',
                        variable: '--color-background-surface',
                    },
                },
            ],
        },
        {
            name: 'R6b bare foundation token in an arbitrary value',
            code: '<div class="duration-[var(--foundation-motion-duration-slow)]"></div>',
            options,
            errors: [{ messageId: 'bareDesignTokenVariable' }],
        },

        // -- Surfaces that must not become bypasses -------------------------
        {
            name: 'S2b unknown class in [class.foo] is located on the key',
            code: '<div [class.fleex]="x"></div>',
            options,
            errors: [{ ...suggested('fleex', 'flex'), line: 1, column: 13, endColumn: 18 }],
        },
        {
            name: 'S4b unknown class inside an [ngClass] key',
            code: `<div [ngClass]="{ 'fleex p-4': cond }"></div>`,
            options,
            errors: [suggested('fleex', 'flex')],
        },
        {
            name: 'S5b unknown class in routerLinkActive',
            code: '<a routerLinkActive="fleex"></a>',
            options,
            errors: [suggested('fleex', 'flex')],
        },
        {
            // The complete tokens are still validated, and the unresolved tail is
            // reported: a partial token such as `'type-'` is never invented into
            // a class name, but it is not silently accepted either.
            name: 'S3d resolvable operands validated, unresolved tail reported',
            code: `<div [class]="'badge fleex ' + variantClass()"></div>`,
            options,
            errors: [{ messageId: 'unresolvedClassName' }, suggested('fleex', 'flex')],
        },
        {
            name: 'S1b exact location inside a multi-line class list',
            code: '<div\n    class="flex\n           fleex"\n></div>',
            options,
            errors: [{ ...suggested('fleex', 'flex'), line: 3, column: 12, endColumn: 17 }],
        },
    ],
})

scriptTester.run('no-custom-classname (component metadata)', rule, {
    valid: [
        {
            name: 'S6 Angular component host classes',
            code: `@Component({ host: { class: 'inline-flex items-center' } }) class C {}`,
            options,
        },
        // -- UNSUPPORTED: silence here is a gap, not a pass -----------------
        {
            name: 'U1 UNSUPPORTED: @HostBinding class key',
            code: `class C { @HostBinding('class.bogus-hostbinding') flag = true }`,
            options,
        },
        {
            name: 'U2 UNSUPPORTED: imperative classList mutation',
            code: `el.classList.add('bogus-classlist')`,
            options,
        },
        {
            name: 'U3 UNSUPPORTED: class names assembled in component TypeScript',
            code: `const cssClass = 'bogus-computed-class'`,
            options,
        },
    ],
    invalid: [
        {
            name: 'S6b unknown host metadata class',
            code: `@Component({ host: { class: 'inline-flex items-centre' } }) class C {}`,
            options,
            errors: [suggested('items-centre', 'items-center')],
        },
        {
            name: 'S6c malformed descriptor syntax in host metadata',
            code: `@Component({ host: { class: 'a b | flex' } }) class C {}`,
            options,
            errors: [{ messageId: 'multipleDescriptors' }],
        },
        {
            name: 'S6d non-literal host class is not a bypass',
            code: `@Component({ host: { class: buildClasses() } }) class C {}`,
            options,
            errors: [{ messageId: 'unresolvedClassName' }],
        },
    ],
})

// eslint-disable-next-line no-console
console.log('MAE-105 corpus: all cases passed')
