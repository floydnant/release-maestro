/**
 * PROTOTYPE (MAE-107) — acceptance corpus for the standalone class scanner.
 *
 * Each case states a class surface and the class names the scanner must reject. Cases the approach
 * cannot support are listed at the bottom as explicit `unsupported` records, so the comparison with
 * the other MAE-100 prototypes stays honest.
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
    collectHostClasses,
    collectTemplateClasses,
    declaredClasses,
    isKnownClass,
    readComponentUnits,
    resolveTailwindClasses,
    splitClassAttribute,
    suggest,
} = require('./class-scan.cjs')

const projectRoot = path.resolve(__dirname, '..')
const globalClasses = new Set([
    ...declaredClasses(fs.readFileSync(path.join(projectRoot, 'src/styles.css'), 'utf8')),
    ...declaredClasses(
        fs.readFileSync(path.join(projectRoot, 'src/styles/design-tokens.generated.css'), 'utf8'),
    ),
])

const ownStyles = `
    .progress-segment { background: var(--color-action-primary); }
    .track { position: relative; }
`
const ownClasses = declaredClasses(ownStyles)

/**
 * The corpus. `unknown` is the exact set of class names the scanner must report for the template;
 * anything else it reports is a false positive.
 */
const corpus = [
    {
        name: 'static utility that Tailwind can build',
        template: '<div class="flex items-center gap-2"></div>',
        unknown: [],
    },
    {
        name: 'static semantic-token utility',
        template: '<div class="bg-background-surface text-content-secondary border-border-subtle"></div>',
        unknown: [],
    },
    {
        name: 'unknown static class that Tailwind silently drops',
        template: '<p class="type-code-sl"></p>',
        unknown: ['type-code-sl'],
    },
    {
        name: 'utility outside the project spacing scale',
        template: '<div class="p-7 max-h-72"></div>',
        unknown: ['p-7', 'max-h-72'],
    },
    {
        name: 'arbitrary value with commas and nested functions',
        template:
            '<div class="bg-[color-mix(in_srgb,var(--color-status-info-background)_50%,transparent)]"></div>',
        unknown: [],
    },
    {
        name: 'built-in, responsive and project-defined variants',
        template: '<div class="hover:bg-action-primary-hover md:flex not-hover:opacity-50"></div>',
        unknown: [],
    },
    {
        name: 'utilities added by local Tailwind plugins',
        template: '<div class="glass wrap-nicely child-focus-ring"></div>',
        unknown: [],
    },
    {
        name: 'component classes authored in global styles',
        template: '<button class="btn-primary badge panel"></button>',
        unknown: [],
    },
    {
        name: 'generated design-token typography classes',
        template: '<p class="type-body-sm type-label-md"></p>',
        unknown: [],
    },
    {
        name: 'class declared in the component own stylesheet',
        template: '<div class="progress-segment"></div>',
        unknown: [],
    },
    {
        name: 'semantic descriptor before the pipe is not a styling class',
        template: '<div class="title-bar__button | flex items-center gap-1"></div>',
        unknown: [],
    },
    {
        name: 'styling half of a piped class list is still validated',
        template: '<div class="title-bar__button | flex nonexistent-utility"></div>',
        unknown: ['nonexistent-utility'],
    },
    {
        name: 'variant markers Tailwind never emits CSS for',
        template: '<div class="group peer group/item"></div>',
        unknown: [],
    },
    {
        name: 'framework-owned classes',
        template: '<div class="cdk-overlay-pane ng-star-inserted"></div>',
        unknown: [],
    },
    {
        name: 'important modifier',
        template: '<div class="!flex"></div>',
        unknown: [],
    },
    {
        name: '[class.foo] binding',
        template: '<div [class.rounded-l-full]="a" [class.rounded-l-huge]="b"></div>',
        unknown: ['rounded-l-huge'],
    },
    {
        name: '[ngClass] object keys',
        template: `<div [ngClass]="{ 'ml-52 flex': a, 'ml-53': b }"></div>`,
        unknown: ['ml-53'],
    },
    {
        name: '[ngClass] object key using the descriptor pipe',
        template: `<div [ngClass]="{ 'dropzone-active | border-border-focus': a }"></div>`,
        unknown: [],
    },
    {
        name: '[ngClass] array of literals',
        template: `<div [ngClass]="[flag, 'flex', 'flexx']"></div>`,
        unknown: ['flexx'],
    },
    {
        name: '[ngClass] ternary branches',
        template: `<div [ngClass]="a ? 'opacity-30' : 'opacity-31'"></div>`,
        unknown: ['opacity-31'],
    },
    {
        name: '[class] concatenation keeps complete literals and drops the glued token',
        template: `<span [class]="'badge border ' + workerHealthClass()"></span>`,
        unknown: [],
    },
    {
        name: '[class] concatenation with a bad complete literal',
        template: `<span [class]="'badgee border ' + workerHealthClass()"></span>`,
        unknown: ['badgee'],
    },
    {
        name: 'fully dynamic expression is not guessed at',
        template: `<p [ngClass]="'type-' + token"></p>`,
        unknown: [],
    },
    {
        name: 'routerLinkActive, static and bound',
        template: '<a routerLinkActive="active-link"></a><a [routerLinkActive]="\'active-linkk\'"></a>',
        unknown: ['active-linkk'],
    },
    {
        name: 'interpolated class attribute keeps the static tokens',
        template: '<div class="p-2 {{ extra }} flexx"></div>',
        unknown: ['flexx'],
    },
    {
        name: 'classes inside @if / @for / @switch blocks',
        template: `@if (a) { <i class="flexx"></i> } @for (x of xs; track x) { <b class="p-99"></b> }
            @switch (mode) { @case (1) { <u class="gap-99"></u> } }`,
        unknown: ['flexx', 'p-99', 'gap-99'],
    },
    {
        name: 'classes inside ng-template and structural directives',
        template: '<ng-template><i class="flexx"></i></ng-template><b *ngIf="a" class="p-99"></b>',
        unknown: ['flexx', 'p-99'],
    },
    {
        name: 'attribute binding [attr.class]',
        template: `<div [attr.class]="'flexx'"></div>`,
        unknown: ['flexx'],
    },
]

const templateEntries = template => {
    const { classes, descriptors, unresolved } = collectTemplateClasses(template, 'corpus.html')
    return { classes, descriptors, unresolved }
}

test('acceptance corpus: only genuinely unknown classes are reported', async () => {
    const perCase = corpus.map(entry => ({ entry, ...templateEntries(entry.template) }))
    const candidates = new Set(perCase.flatMap(({ classes }) => classes.map(item => item.name)))
    const tailwindClasses = await resolveTailwindClasses(candidates)

    const failures = []
    for (const { entry, classes } of perCase) {
        const reported = classes
            .filter(item => !isKnownClass(item.name, { tailwindClasses, globalClasses, ownClasses }))
            .map(item => item.name)

        try {
            assert.deepEqual([...new Set(reported)].sort(), [...entry.unknown].sort())
        } catch {
            failures.push(`${entry.name}: expected [${entry.unknown}] but reported [${reported}]`)
        }
    }

    assert.deepEqual(failures, [], failures.join('\n'))
})

test('host metadata is a class surface', async () => {
    const [unit] = readComponentUnits(
        path.join(projectRoot, 'src/app/shared/components/icon/icon.component.ts'),
    )
    const { classes } = collectHostClasses(unit)
    assert.ok(classes.length > 0, 'expected host classes on the icon component')

    const tailwindClasses = await resolveTailwindClasses(classes.map(item => item.name))
    const unknown = classes
        .filter(item => !isKnownClass(item.name, { tailwindClasses, globalClasses }))
        .map(item => item.name)
    assert.deepEqual(unknown, [])
})

test('host metadata rejects an unknown class and reads [class.x] bindings', () => {
    const unit = {
        hostEntries: [
            { key: 'class', value: 'icon | inline-flex nonexistent-host-utility', offset: 0 },
            { key: '[class.spin]', value: null, offset: 0 },
        ],
    }
    const { classes, descriptors } = collectHostClasses(unit)
    assert.deepEqual(
        classes.map(item => item.name),
        ['inline-flex', 'nonexistent-host-utility', 'spin'],
    )
    assert.deepEqual(
        descriptors.map(item => item.name),
        ['icon'],
    )
})

test('dynamic expressions are recorded as unresolved instead of guessed', () => {
    const { unresolved } = templateEntries(`<p [ngClass]="'type-' + token"></p>`)
    assert.equal(unresolved.length, 1)
})

test('findings carry a usable position and a near-miss suggestion', async () => {
    const template = '<div class="flex">\n    <p class="type-code-sl"></p>\n</div>'
    const { classes } = collectTemplateClasses(template, 'corpus.html')
    const finding = classes.find(item => item.name === 'type-code-sl')
    assert.ok(finding, 'expected the unknown class to be collected')
    assert.equal(template.slice(finding.offset, finding.offset + finding.name.length), 'type-code-sl')

    const tailwindClasses = await resolveTailwindClasses(classes.map(item => item.name))
    assert.equal(suggest('type-code-sl', [...tailwindClasses, ...globalClasses]), 'type-code-sm')
})

test('descriptor pipe splitting', () => {
    assert.deepEqual(splitClassAttribute('card__header | flex gap-2'), {
        descriptors: 'card__header ',
        styling: ' flex gap-2',
        descriptorOffset: 0,
        stylingOffset: 14,
    })
    assert.equal(splitClassAttribute('flex gap-2').styling, 'flex gap-2')
    assert.equal(splitClassAttribute('flex gap-2').descriptors, '')
})

/**
 * Cases this approach cannot decide. They are asserted as *not reported* so the prototype cannot
 * quietly start guessing, and so the MAE-100 comparison can weigh the gap.
 */
const unsupported = [
    {
        name: 'class fragments assembled at runtime in TypeScript',
        template: `<p [ngClass]="'type-' + token"></p>`,
        reason: 'the scanner cannot enumerate the values of a TypeScript expression',
    },
    {
        name: 'token glued to a dynamic fragment',
        template: `<span [class]="'text-' + tone()"></span>`,
        reason: 'the completed class name only exists at runtime',
    },
    {
        name: 'classes applied through the DOM API',
        template: '<div class="flex"></div>',
        reason: 'element.classList.add(…) lives outside every class surface the scanner parses',
    },
]

test('unsupported cases are not reported as findings', async () => {
    for (const entry of unsupported) {
        const { classes } = templateEntries(entry.template)
        const tailwindClasses = await resolveTailwindClasses(classes.map(item => item.name))
        const reported = classes
            .filter(item => !isKnownClass(item.name, { tailwindClasses, globalClasses, ownClasses }))
            .map(item => item.name)
        assert.deepEqual(reported, [], `${entry.name} — ${entry.reason}`)
    }
})
