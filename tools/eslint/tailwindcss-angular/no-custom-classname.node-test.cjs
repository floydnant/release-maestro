'use strict'

/**
 * PROTOTYPE (MAE-105) — acceptance corpus for
 * `tailwindcss-angular/no-custom-classname`.
 *
 * Run: `make prototype-classname-test` (from the repository root).
 *
 * Each case is labelled with the corpus id used in
 * `docs/prototypes/mae-105-eslint-plugin-tailwindcss.md`.
 */

const { RuleTester } = require('eslint')
const templateParser = require('@angular-eslint/template-parser')
const tsParser = require('@typescript-eslint/parser')
const { join } = require('node:path')

const rule = require('./no-custom-classname.cjs')

const workspaceRoot = join(__dirname, '../../..')

const options = [
    {
        config: join(workspaceRoot, 'apps/maestro-renderer/tailwind.config.js'),
        cssFiles: [
            'apps/maestro-renderer/src/styles.css',
            'apps/maestro-renderer/src/styles/**/*.css',
            'apps/maestro-renderer/src/app/**/*.css',
        ],
        whitelist: ['glass', 'child-focus-ring', 'wrap-nicely'],
    },
]

const error = classname => ({ messageId: 'customClassnameDetected', data: { classname } })

const templateTester = new RuleTester({ languageOptions: { parser: templateParser } })
const scriptTester = new RuleTester({
    languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
})

templateTester.run('no-custom-classname (template)', rule, {
    valid: [
        { name: 'C1 core Tailwind utility', code: '<div class="flex items-center"></div>', options },
        {
            name: 'C3 design-token utility',
            code: '<div class="text-content-primary type-body-sm"></div>',
            options,
        },
        {
            name: 'C4 authored global class',
            code: '<div class="btn btn-primary badge panel"></div>',
            options,
        },
        {
            name: 'C5 component-scoped CSS class',
            code: '<div class="title-bar progress-segment"></div>',
            options,
        },
        { name: 'C6 descriptor before the pipe', code: '<div class="sidebar | flex w-52"></div>', options },
        { name: 'C7 descriptor-only class list', code: '<div class="favicon |"></div>', options },
        {
            name: 'C8 arbitrary value',
            code: '<div class="h-[130px] bg-[color-mix(in_srgb,red_40%,transparent)]"></div>',
            options,
        },
        {
            name: 'C9 built-in and custom variants',
            code: '<div class="hover:bg-action-quiet-hover not-hover:opacity-0 md:flex"></div>',
            options,
        },
        {
            name: 'C10 tailwind plugin utility',
            code: '<div class="glass wrap-nicely child-focus-ring"></div>',
            options,
        },
        { name: 'C11 valid [class.x] binding', code: '<div [class.rounded-l-full]="a"></div>', options },
        {
            name: 'C12 valid [ngClass] object keys',
            code: `<div [ngClass]="{ 'ml-52': a, 'opacity-30 blur-sm': b }"></div>`,
            options,
        },
        { name: 'C13 valid [class] literal', code: `<div [class]="'flex gap-2'"></div>`, options },
        { name: 'C14 valid routerLinkActive', code: '<a routerLinkActive="active-link"></a>', options },
        {
            name: 'C15 opaque concatenation is not guessed',
            code: `<div [ngClass]="'type-' + token"></div>`,
            options,
        },
        {
            name: 'C16 complete literal part of a concatenation',
            code: `<div [class]="'badge border ' + healthClass()"></div>`,
            options,
        },
        {
            name: 'C17 non-class attributes are ignored',
            code: '<img alt="totally-not-a-class" data-testid="nope" />',
            options,
        },
        {
            name: 'C18 conditional binding branches',
            code: `<div [class]="a ? 'flex' : 'grid'"></div>`,
            options,
        },
        { name: 'C19 array binding', code: `<div [class]="['flex', 'gap-2']"></div>`, options },
        { name: 'C20 class list inside control flow', code: '@if (a) { <div class="flex"></div> }', options },
    ],
    invalid: [
        {
            name: 'C2 unknown static class',
            code: '<div class="type-code-sl"></div>',
            options,
            errors: [error('type-code-sl')],
        },
        {
            name: 'C21 removed-from-theme utility (silently emits no CSS)',
            code: '<div class="py-14 opacity-80 max-h-72"></div>',
            options,
            errors: [error('py-14'), error('opacity-80'), error('max-h-72')],
        },
        {
            name: 'C22 unknown class after the descriptor pipe',
            code: '<div class="sidebar | flex bg-content-nope"></div>',
            options,
            errors: [error('bg-content-nope')],
        },
        {
            name: 'C23 unknown [class.x] binding',
            code: '<div [class.rounded-l-fulll]="a"></div>',
            options,
            errors: [error('rounded-l-fulll')],
        },
        {
            name: 'C24 unknown [ngClass] object key',
            code: `<div [ngClass]="{ 'ml-52 blurr-sm': a }"></div>`,
            options,
            errors: [error('blurr-sm')],
        },
        {
            name: 'C25 unknown [class] literal',
            code: `<div [class]="'flex gap-2 typo'"></div>`,
            options,
            errors: [error('typo')],
        },
        {
            name: 'C26 unknown routerLinkActive class',
            code: '<a routerLinkActive="active-linkk"></a>',
            options,
            errors: [error('active-linkk')],
        },
        {
            name: 'C31 unknown [attr.class] literal',
            code: `<div [attr.class]="'gap-97'"></div>`,
            options,
            errors: [error('gap-97')],
        },
        {
            name: 'C27 unknown complete literal in a concatenation',
            code: `<div [class]="'badgee border ' + healthClass()"></div>`,
            options,
            errors: [error('badgee')],
        },
    ],
})

scriptTester.run('no-custom-classname (script)', rule, {
    valid: [
        {
            name: 'C28 valid host metadata',
            code: `@Component({ host: { class: 'inline-flex items-center' } }) class C {}`,
            options,
        },
        {
            name: 'C29 unrelated object property named class',
            code: `const x = { class: 'not-a-classname-context' }`,
            options,
        },
        // C32/C33 are UNSUPPORTED, not passing: the rule stays silent on class
        // names that only exist in imperative TypeScript.
        {
            name: 'C32 unsupported: @HostBinding class key',
            code: `class C { @HostBinding('class.bogus-hostbinding') flag = true }`,
            options,
        },
        {
            name: 'C33 unsupported: imperative classList mutation',
            code: `el.classList.add('bogus-classlist')`,
            options,
        },
    ],
    invalid: [
        {
            name: 'C30 unknown host metadata class',
            code: `@Component({ host: { class: 'inline-flex items-centre' } }) class C {}`,
            options,
            errors: [error('items-centre')],
        },
    ],
})

// eslint-disable-next-line no-console
console.log('MAE-105 corpus: all cases passed')
