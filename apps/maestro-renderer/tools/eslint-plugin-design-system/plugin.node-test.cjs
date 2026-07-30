/**
 * Shared acceptance corpus for the MAE-106 prototype. Every class surface the renderer actually uses
 * appears here once, so the recorded pass/fail/unsupported evidence is reproducible.
 *
 * Run with: node --test apps/maestro-renderer/tools/eslint-plugin-design-system/plugin.node-test.cjs
 */
const path = require('node:path')
const { RuleTester } = require('eslint')
const templateParser = require('@angular-eslint/template-parser')
const typescriptParser = require('@typescript-eslint/parser')

const templateRule = require('./rules/valid-template-classnames.cjs')
const hostRule = require('./rules/valid-host-classnames.cjs')

const FIXTURE_TEMPLATE = path.join(__dirname, 'fixtures/specimen.component.html')
const FIXTURE_COMPONENT = path.join(__dirname, 'fixtures/specimen.component.ts')

const unknown = className => ({ messageId: 'unknownClass', data: { className } })

const templateTester = new RuleTester({
    languageOptions: { parser: templateParser },
})

templateTester.run('valid-template-classnames', templateRule, {
    valid: [
        // Static utilities, arbitrary values, variants, and plugin utilities.
        { filename: FIXTURE_TEMPLATE, code: '<div class="flex items-center gap-3"></div>' },
        {
            filename: FIXTURE_TEMPLATE,
            code: '<div class="w-[130px] bg-[color-mix(in_srgb,white_40%,transparent)]"></div>',
        },
        {
            filename: FIXTURE_TEMPLATE,
            code: '<div class="hover:bg-background-surface group-hover:opacity-100 @lg:flex"></div>',
        },
        { filename: FIXTURE_TEMPLATE, code: '<div class="glass wrap-nicely child-focus-ring"></div>' },
        { filename: FIXTURE_TEMPLATE, code: '<div class="group peer group/row"></div>' },

        // Authored classes: global stylesheet, generated token stylesheet, component styles.
        { filename: FIXTURE_TEMPLATE, code: '<div class="btn-nkd-neutral badge panel"></div>' },
        { filename: FIXTURE_TEMPLATE, code: '<div class="type-body-sm type-code-sm"></div>' },
        { filename: FIXTURE_TEMPLATE, code: '<div class="scoped-only nested-scoped inline-scoped"></div>' },

        // The `descriptor | utilities` pipe convention.
        {
            filename: FIXTURE_TEMPLATE,
            code: '<div class="title-bar__drag-region | flex items-center"></div>',
        },

        // Dynamic surfaces.
        { filename: FIXTURE_TEMPLATE, code: '<div [class.rounded-l-full]="$first"></div>' },
        { filename: FIXTURE_TEMPLATE, code: '<div [ngClass]="{ \'ml-52\': isMacos }"></div>' },
        { filename: FIXTURE_TEMPLATE, code: '<div [ngClass]="{ \'opacity-30 blur-sm\': hidden }"></div>' },
        { filename: FIXTURE_TEMPLATE, code: "<div [class]=\"cond ? 'flex' : 'hidden'\"></div>" },
        { filename: FIXTURE_TEMPLATE, code: '<a routerLinkActive="active-link"></a>' },
        { filename: FIXTURE_TEMPLATE, code: '<div ngClass="flex gap-2"></div>' },

        // Unsupported by design: the class list only exists at runtime, so nothing is asserted.
        { filename: FIXTURE_TEMPLATE, code: '<div [class]="workerHealthClass()"></div>' },
        { filename: FIXTURE_TEMPLATE, code: '<div [ngClass]="classMap"></div>' },
        { filename: FIXTURE_TEMPLATE, code: '<div class="{{ dynamicClass }}"></div>' },
        // Only the fragment touching the runtime value is skipped; `badge` and `border` are checked.
        { filename: FIXTURE_TEMPLATE, code: '<div [class]="\'badge border \' + workerHealthClass()"></div>' },
        { filename: FIXTURE_TEMPLATE, code: '<div [ngClass]="\'type-\' + token"></div>' },

        // Non-class attributes and bindings are untouched.
        { filename: FIXTURE_TEMPLATE, code: '<div [style.width]="w" [attr.role]="r" title="flex"></div>' },
    ],

    invalid: [
        {
            filename: FIXTURE_TEMPLATE,
            code: '<p class="type-code-sl"></p>',
            errors: [unknown('type-code-sl')],
        },
        {
            filename: FIXTURE_TEMPLATE,
            code: '<div class="flex bg-nonsense"></div>',
            errors: [unknown('bg-nonsense')],
        },
        {
            // Descriptors are exempt, styling classes right of the pipe are not.
            filename: FIXTURE_TEMPLATE,
            code: '<div class="sidebar | flex bg-nonsense"></div>',
            errors: [unknown('bg-nonsense')],
        },
        {
            filename: FIXTURE_TEMPLATE,
            code: '<div [class.rounded-nope]="$first"></div>',
            errors: [unknown('rounded-nope')],
        },
        {
            filename: FIXTURE_TEMPLATE,
            code: '<div [ngClass]="{ \'ml-52 oops-class\': isMacos }"></div>',
            errors: [unknown('oops-class')],
        },
        {
            filename: FIXTURE_TEMPLATE,
            code: '<div [class]="\'badge borderx \' + workerHealthClass()"></div>',
            errors: [unknown('borderx')],
        },
        {
            filename: FIXTURE_TEMPLATE,
            code: '<a routerLinkActive="active-linkk"></a>',
            errors: [unknown('active-linkk')],
        },
        {
            // A component-scoped class is only known inside its own component.
            filename: path.join(__dirname, 'fixtures/other.component.html'),
            code: '<div class="scoped-only"></div>',
            errors: [unknown('scoped-only')],
        },
        {
            filename: FIXTURE_TEMPLATE,
            code: "<div [class]=\"cond ? 'flex' : 'hiddenn'\"></div>",
            errors: [unknown('hiddenn')],
        },
        {
            // `reportDynamic` makes the unsupported cases visible instead of silent.
            filename: FIXTURE_TEMPLATE,
            code: '<div [class]="workerHealthClass()"></div>',
            options: [{ reportDynamic: true }],
            errors: [{ messageId: 'dynamicClassList' }],
        },
        {
            filename: FIXTURE_TEMPLATE,
            code: '<div [class]="\'badge border\' + workerHealthClass()"></div>',
            options: [{ reportDynamic: true }],
            errors: [{ messageId: 'dynamicClassList' }, { messageId: 'partialClass', data: { className: 'border' } }],
        },
    ],
})

const typescriptTester = new RuleTester({
    languageOptions: { parser: typescriptParser },
})

typescriptTester.run('valid-host-classnames', hostRule, {
    valid: [
        {
            filename: FIXTURE_COMPONENT,
            code: "@Component({ host: { class: 'inline-flex items-center scoped-only' } }) class C {}",
        },
        {
            filename: FIXTURE_COMPONENT,
            code: "@Component({ host: { class: 'progress-ring | inline-block' } }) class C {}",
        },
        { filename: FIXTURE_COMPONENT, code: "@Component({ host: { 'data-testid': 'x' } }) class C {}" },
        { filename: FIXTURE_COMPONENT, code: '@Component({ host: { class: someExpression } }) class C {}' },
    ],
    invalid: [
        {
            filename: FIXTURE_COMPONENT,
            code: "@Component({ host: { class: 'inline-flex nope-class' } }) class C {}",
            errors: [unknown('nope-class')],
        },
        {
            filename: FIXTURE_COMPONENT,
            code: "@Directive({ host: { class: 'block sizee-full' } }) class D {}",
            errors: [unknown('sizee-full')],
        },
    ],
})
