/**
 * PROTOTYPE (MAE-107) — acceptance corpus for the standalone class scanner.
 *
 * The corpus mirrors MAE-100's shared list so the three prototypes can be compared on the same
 * cases. Every case records an explicit verdict:
 *
 *   accept       the scanner must stay silent
 *   reject       the scanner must report exactly the listed rules
 *   unsupported  the approach cannot decide the case; asserted as *not* reported so the prototype
 *                cannot quietly start guessing, and so the comparison can weigh the gap
 *
 * Sibling tooling (`design-tokens.node-test.cjs`) uses `node:test`, so this does too. Moving the
 * design-system tooling onto Jest is tracked separately on MAE-100.
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
    bareTokenReferences,
    collectHostClasses,
    collectTemplateClasses,
    declaredClasses,
    isKnownClass,
    isTokenNamespaceExempt,
    lineStarts,
    positionAt,
    readComponentUnits,
    readSuppressions,
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
    .dial { --rotation: 0deg; transform: rotate(var(--rotation)); }
`
const ownClasses = declaredClasses(ownStyles)

const ACCEPT = []

/** The corpus. `expect` is the exact multiset of rules the scanner must report for the case. */
const corpus = [
    // --- classes the authorities can produce ------------------------------------------------------
    {
        name: 'static utility that Tailwind can build',
        template: '<div class="flex items-center gap-2"></div>',
        expect: ACCEPT,
    },
    {
        name: 'static semantic-token utility',
        template: '<div class="bg-background-surface text-content-secondary border-border-subtle"></div>',
        expect: ACCEPT,
    },
    {
        name: 'built-in, responsive and project-defined variants',
        template: '<div class="hover:bg-action-primary-hover md:flex not-hover:opacity-50"></div>',
        expect: ACCEPT,
    },
    {
        name: 'utilities added by local Tailwind plugins',
        template: '<div class="glass wrap-nicely child-focus-ring"></div>',
        expect: ACCEPT,
    },
    {
        name: 'component classes authored in global styles',
        template: '<button class="btn-primary badge panel"></button>',
        expect: ACCEPT,
    },
    {
        name: 'generated design-token typography classes',
        template: '<p class="type-body-sm type-label-md"></p>',
        expect: ACCEPT,
    },
    {
        name: 'class declared in the owning component stylesheet',
        template: '<div class="progress-segment"></div>',
        expect: ACCEPT,
    },
    {
        name: 'component-local custom property in an arbitrary value',
        template: '<div class="[--rotation:45deg] rotate-[var(--rotation)]"></div>',
        expect: ACCEPT,
    },
    {
        name: 'variant markers Tailwind never emits CSS for',
        template: '<div class="group peer group/item"></div>',
        expect: ACCEPT,
    },
    {
        name: 'framework-owned classes',
        template: '<div class="cdk-overlay-pane ng-star-inserted"></div>',
        expect: ACCEPT,
    },
    { name: 'important modifier', template: '<div class="!flex"></div>', expect: ACCEPT },

    // --- unknown class names ----------------------------------------------------------------------
    {
        name: 'misspelled utility (MAE-107: `fleex`)',
        template: '<div class="fleex"></div>',
        expect: ['unknown-class'],
    },
    {
        name: 'unknown static class that Tailwind silently drops (MAE-107: `type-code-sl`)',
        template: '<p class="type-code-sl"></p>',
        expect: ['unknown-class'],
    },
    {
        name: 'class missing from both the owning component CSS and global CSS',
        template: '<div class="progress-segment progress-segmnt"></div>',
        expect: ['unknown-class'],
    },
    {
        name: 'class owned by a *different* component stylesheet',
        template: '<div class="settings-item"></div>',
        expect: ['unknown-class'],
    },
    {
        name: 'utility outside the project spacing scale',
        template: '<div class="p-7 max-h-72"></div>',
        expect: ['unknown-class', 'unknown-class'],
    },
    {
        name: '[class.foo] binding',
        template: '<div [class.rounded-l-full]="a" [class.rounded-l-huge]="b"></div>',
        expect: ['unknown-class'],
    },
    {
        name: '[ngClass] object keys',
        template: `<div [ngClass]="{ 'ml-52 flex': a, 'ml-53': b }"></div>`,
        expect: ['unknown-class'],
    },
    {
        name: '[ngClass] array of literals',
        template: `<div [ngClass]="[flag, 'flex', 'fleex']"></div>`,
        expect: ['unknown-class', 'unresolved-class-expression'],
    },
    {
        name: '[ngClass] ternary branches',
        template: `<div [ngClass]="a ? 'opacity-30' : 'opacity-31'"></div>`,
        expect: ['unknown-class'],
    },
    {
        name: 'routerLinkActive, static and bound',
        template: '<a routerLinkActive="active-link"></a><a [routerLinkActive]="\'active-linkk\'"></a>',
        expect: ['unknown-class'],
    },
    {
        name: 'interpolated class attribute keeps the static tokens',
        template: '<div class="p-2 {{ extra }} fleex"></div>',
        expect: ['unknown-class', 'unresolved-class-expression'],
    },
    {
        name: 'classes inside @if / @for / @switch blocks',
        template: `@if (a) { <i class="fleex"></i> } @for (x of xs; track x) { <b class="p-99"></b> }
            @switch (mode) { @case (1) { <u class="gap-99"></u> } }`,
        expect: ['unknown-class', 'unknown-class', 'unknown-class'],
    },
    {
        name: 'classes inside ng-template and structural directives',
        template: '<ng-template><i class="fleex"></i></ng-template><b *ngIf="a" class="p-99"></b>',
        expect: ['unknown-class', 'unknown-class'],
    },
    {
        name: 'attribute binding [attr.class]',
        template: `<div [attr.class]="'fleex'"></div>`,
        expect: ['unknown-class'],
    },

    // --- the `descriptor | styling` convention ----------------------------------------------------
    {
        name: 'semantic descriptor before the pipe is not a styling class',
        template: '<div class="title-bar__button | flex items-center gap-1"></div>',
        expect: ACCEPT,
    },
    {
        name: '[ngClass] object key using the descriptor pipe',
        template: `<div [ngClass]="{ 'dropzone-active | border-border-focus': a }"></div>`,
        expect: ACCEPT,
    },
    {
        name: 'styling half of a piped class list is still validated',
        template: '<div class="title-bar__button | flex fleex"></div>',
        expect: ['unknown-class'],
    },
    {
        name: 'empty descriptor before the pipe',
        template: '<div class=" | flex gap-2"></div>',
        expect: ['malformed-descriptor'],
    },
    {
        name: 'multiple descriptors before the pipe',
        template: '<div class="title-bar__button icon | flex"></div>',
        expect: ['malformed-descriptor'],
    },
    {
        name: 'malformed pipe syntax: more than one separator',
        template: '<div class="card | header | flex"></div>',
        expect: ['malformed-descriptor'],
    },
    {
        name: 'malformed descriptor inside an [ngClass] key',
        template: `<div [ngClass]="{ 'a b | flex': x }"></div>`,
        expect: ['malformed-descriptor'],
    },

    // --- design-token namespace -------------------------------------------------------------------
    {
        name: 'bare design-token variable inside a Tailwind arbitrary value',
        template:
            '<div class="bg-[color-mix(in_srgb,var(--color-status-info-background)_50%,transparent)]"></div>',
        expect: ['bare-design-token'],
    },
    {
        name: 'design token consumed through the Tailwind namespace',
        template: '<div class="bg-status-info-background text-content-primary"></div>',
        expect: ACCEPT,
    },

    // --- dynamic class construction ---------------------------------------------------------------
    {
        name: 'class name assembled from an untyped fragment',
        template: `<p [ngClass]="'type-' + token"></p>`,
        expect: ['unresolved-class-expression'],
    },
    {
        name: 'token glued to a dynamic fragment',
        template: `<span [class]="'text-' + tone()"></span>`,
        expect: ['unresolved-class-expression'],
    },
    {
        name: 'concatenation keeps complete literals and drops the glued token',
        template: `<span [class]="'badge border ' + workerHealthClass()"></span>`,
        expect: ['unresolved-class-expression'],
    },
    {
        name: 'concatenation with a bad complete literal',
        template: `<span [class]="'badgee border ' + workerHealthClass()"></span>`,
        expect: ['unknown-class', 'unresolved-class-expression'],
    },
    {
        name: 'dynamic selection through the generated, typed token API',
        template: `<div [class]="semanticColor(tone())"></div>`,
        expect: ACCEPT,
    },
    {
        name: 'generated token identifier list read dynamically',
        template: `<div [ngClass]="semanticColorIdentifiers[index]"></div>`,
        expect: ACCEPT,
    },

    // --- suppressions ------------------------------------------------------------------------------
    {
        name: 'explained suppression waives the next element',
        template:
            '<!-- class-scan-disable-next-line: legacy class owned by index.html -->\n<div class="fleex"></div>',
        expect: ACCEPT,
    },
    {
        name: 'explained suppression waives a multi-line element it precedes',
        template:
            '<!-- class-scan-disable-next-line: legacy class owned by index.html -->\n<div\n    class="fleex"\n></div>',
        expect: ACCEPT,
    },
    {
        name: 'suppression does not leak past the element it precedes',
        template:
            '<!-- class-scan-disable-next-line: legacy class owned by index.html -->\n<div class="fleex"></div>\n<div class="fleex"></div>',
        expect: ['unknown-class'],
    },
]

const analyse = (template, tailwindClasses) => {
    const { classes, unresolved, problems } = collectTemplateClasses(template, 'corpus.html')
    const { allowed } = readSuppressions(template)
    const starts = lineStarts(template)

    const suppressed = entry => {
        const line = positionAt(starts, entry.offset).line
        const elementLine =
            entry.elementOffset === undefined ? line : positionAt(starts, entry.elementOffset).line
        return allowed.has(line) || allowed.has(elementLine)
    }

    const findings = []
    for (const entry of classes) {
        if (suppressed(entry)) continue
        if (!isKnownClass(entry.name, { tailwindClasses, globalClasses, ownClasses })) {
            findings.push({ rule: 'unknown-class', detail: entry.name })
        }
        for (const reference of bareTokenReferences(entry.name)) {
            findings.push({ rule: 'bare-design-token', detail: reference.token })
        }
    }
    for (const entry of problems) {
        if (!suppressed(entry)) findings.push({ rule: 'malformed-descriptor', detail: entry.message })
    }
    for (const entry of unresolved) {
        if (!suppressed(entry)) findings.push({ rule: 'unresolved-class-expression', detail: entry.origin })
    }
    return findings
}

test('acceptance corpus: every case reports exactly the expected rules', async () => {
    const parsed = corpus.map(entry => ({
        entry,
        classes: collectTemplateClasses(entry.template, 'corpus.html').classes,
    }))
    const tailwindClasses = await resolveTailwindClasses(
        new Set(parsed.flatMap(({ classes }) => classes.map(item => item.name))),
    )

    const failures = []
    for (const { entry } of parsed) {
        const findings = analyse(entry.template, tailwindClasses)
        const reported = findings.map(item => item.rule).sort()
        const expected = [...entry.expect].sort()
        if (reported.join() === expected.join()) continue
        failures.push(
            `${entry.name}: expected [${expected}] but reported ` +
                `[${findings.map(item => `${item.rule}(${item.detail})`)}]`,
        )
    }

    assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`)
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
    const { classes, descriptors, problems } = collectHostClasses(unit)
    assert.deepEqual(
        classes.map(item => item.name),
        ['inline-flex', 'nonexistent-host-utility', 'spin'],
    )
    assert.deepEqual(
        descriptors.map(item => item.name),
        ['icon'],
    )
    assert.deepEqual(problems, [])
})

test('findings carry a usable position and an unambiguous near-miss suggestion', async () => {
    const template = '<div class="flex">\n    <p class="type-code-sl"></p>\n</div>'
    const { classes } = collectTemplateClasses(template, 'corpus.html')
    const finding = classes.find(item => item.name === 'type-code-sl')
    assert.ok(finding, 'expected the unknown class to be collected')
    assert.equal(template.slice(finding.offset, finding.offset + finding.name.length), 'type-code-sl')

    const tailwindClasses = await resolveTailwindClasses(classes.map(item => item.name))
    assert.equal(suggest('type-code-sl', [...tailwindClasses, ...globalClasses]), 'type-code-sm')
})

test('an ambiguous near miss produces no suggestion at all', () => {
    assert.equal(suggest('flexx', ['flex', 'flexy']), null)
    assert.equal(suggest('flexx', ['flex']), 'flex')
})

test('descriptor pipe splitting', () => {
    assert.deepEqual(splitClassAttribute('card__header | flex gap-2'), {
        descriptors: 'card__header ',
        styling: ' flex gap-2',
        descriptorOffset: 0,
        stylingOffset: 14,
        problems: [],
    })
    assert.equal(splitClassAttribute('flex gap-2').styling, 'flex gap-2')
    assert.equal(splitClassAttribute('flex gap-2').descriptors, '')
    assert.equal(splitClassAttribute(' | flex').problems.length, 1)
    assert.equal(splitClassAttribute('a b | flex').problems.length, 1)
    assert.equal(splitClassAttribute('a | b | flex').problems.length, 1)
})

test('bare design-token variables are rejected in product CSS but not elsewhere', () => {
    const styles = `
        .track { transition: opacity var(--foundation-motion-duration-fast); }
        .dial { --rotation: 0deg; transform: rotate(var(--rotation)); }
        .card { background: theme('colors.background-surface'); }
    `
    assert.deepEqual(
        bareTokenReferences(styles).map(item => item.token),
        ['--foundation-motion-duration-fast'],
    )

    assert.equal(
        isTokenNamespaceExempt(path.join(projectRoot, 'src/app/pages/feed/feed.component.css')),
        false,
    )
    assert.equal(
        isTokenNamespaceExempt(
            path.join(projectRoot, 'src/app/pages/design-system/design-system.component.css'),
        ),
        true,
    )
    assert.equal(
        isTokenNamespaceExempt(path.join(projectRoot, 'src/styles/design-tokens.generated.css')),
        true,
    )
})

test('a suppression must explain itself and only covers the following line', () => {
    const { allowed, invalid } = readSuppressions(
        ['<!-- class-scan-disable-next-line: owned by index.html -->', '<div class="fleex"></div>'].join(
            '\n',
        ),
    )
    assert.deepEqual([...allowed.entries()], [[2, 'owned by index.html']])
    assert.deepEqual(invalid, [])

    const bare = readSuppressions('<!-- class-scan-disable-next-line -->\n<div class="fleex"></div>')
    assert.equal(bare.allowed.size, 0)
    assert.deepEqual(bare.invalid, [{ line: 1 }])
})

/**
 * Cases this approach cannot decide. Asserted as *not* reported so the prototype cannot quietly
 * start guessing, and so the MAE-100 comparison can weigh the gap.
 */
const unsupported = [
    {
        name: 'classes applied through the DOM API',
        template: '<div class="flex"></div>',
        reason: 'element.classList.add(…) lives outside every class surface the scanner parses',
    },
    {
        name: 'classes produced inside a TypeScript helper and bound as a whole',
        template: '<div [class]="badgeClasses()"></div>',
        reason: 'reported as unresolved rather than checked; the scanner does not evaluate TypeScript',
        expectUnresolved: true,
    },
    {
        name: 'bare design-token variable in a global stylesheet',
        template: '<div class="flex"></div>',
        reason: 'src/styles.css is shared token infrastructure, not product styling, so it is not scanned',
    },
]

test('unsupported cases are recorded, not guessed at', async () => {
    for (const entry of unsupported) {
        const { classes } = collectTemplateClasses(entry.template, 'corpus.html')
        const tailwindClasses = await resolveTailwindClasses(classes.map(item => item.name))
        const reported = analyse(entry.template, tailwindClasses)
        const expected = entry.expectUnresolved ? ['unresolved-class-expression'] : []
        assert.deepEqual(
            reported.map(item => item.rule),
            expected,
            `${entry.name} — ${entry.reason}`,
        )
    }
})
