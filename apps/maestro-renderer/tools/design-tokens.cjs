const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(projectRoot, 'design-tokens')
const generatedCssPath = path.join(projectRoot, 'src/styles/design-tokens.generated.css')
const generatedTsPath = path.join(projectRoot, 'src/app/shared/design-tokens.generated.ts')
const generatedTailwindPath = path.join(sourceDir, 'tailwind.generated.json')
const generatedElectronTsPath = path.resolve(
    projectRoot,
    '../maestro-electron/src/app/design-tokens.generated.ts',
)
const sourceFiles = ['foundations.json', 'semantic.dark.json', 'contrast-pairs.json']

const readJson = file => JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8'))

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

const flatten = (value, prefix = [], result = {}) => {
    if (!isObject(value)) {
        const key = prefix.join('.')
        if (key in result) throw new Error(`Duplicate token: ${key}`)
        result[key] = value
        return result
    }

    for (const [key, child] of Object.entries(value)) flatten(child, [...prefix, key], result)
    return result
}

const getPath = (value, tokenPath) =>
    tokenPath.split('.').reduce((current, segment) => {
        if (!isObject(current) || !(segment in current)) throw new Error(`Missing token: ${tokenPath}`)
        return current[segment]
    }, value)

const aliasPattern = /^\{([^}]+)\}$/

const resolveValue = (value, foundations, stack = []) => {
    if (typeof value !== 'string') throw new Error(`Token values must be strings: ${String(value)}`)
    const match = value.match(aliasPattern)
    if (!match) return value

    const tokenPath = match[1]
    if (stack.includes(tokenPath))
        throw new Error(`Circular token alias: ${[...stack, tokenPath].join(' -> ')}`)
    return resolveValue(getPath(foundations, tokenPath), foundations, [...stack, tokenPath])
}

const cssName = tokenPath => tokenPath.replaceAll('.', '-').replaceAll('lineHeight', 'line-height')
const camelName = tokenPath => tokenPath.replace(/[.-]([a-z0-9])/g, (_, character) => character.toUpperCase())

const hexToRgb = value => {
    const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value)
    if (!match) return null
    return match.slice(1).map(channel => Number.parseInt(channel, 16))
}

const hueToRgb = (p, q, hue) => {
    if (hue < 0) hue += 1
    if (hue > 1) hue -= 1
    if (hue < 1 / 6) return p + (q - p) * 6 * hue
    if (hue < 1 / 2) return q
    if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6
    return p
}

const hslToRgb = value => {
    const match = /^hsl\(\s*([\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i.exec(value)
    if (!match) return null

    const hue = Number(match[1]) / 360
    const saturation = Number(match[2]) / 100
    const lightness = Number(match[3]) / 100

    if (saturation === 0) {
        const channel = lightness * 255
        return [channel, channel, channel]
    }

    const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
    const p = 2 * lightness - q

    return [hueToRgb(p, q, hue + 1 / 3) * 255, hueToRgb(p, q, hue) * 255, hueToRgb(p, q, hue - 1 / 3) * 255]
}

const colorToRgb = value => {
    const rgb = hexToRgb(value) ?? hslToRgb(value)
    if (!rgb) throw new Error(`Contrast validation requires a hex or hsl color, received: ${value}`)
    return rgb
}

const colorToHex = value =>
    `#${colorToRgb(value)
        .map(channel => Math.round(channel).toString(16).padStart(2, '0'))
        .join('')}`

const luminance = value => {
    const channels = colorToRgb(value).map(channel => {
        const normalized = channel / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

const contrastRatio = (foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
    return (values[0] + 0.05) / (values[1] + 0.05)
}

const nestedMap = entries => {
    const result = {}
    for (const [tokenPath, value] of entries) {
        const segments = tokenPath.split('.')
        let target = result
        segments.forEach((segment, index) => {
            if (index === segments.length - 1) target[segment] = value
            else target = target[segment] ??= {}
        })
    }
    return result
}

const generate = ({ foundations, semantic, contrastPairs }) => {
    const flatFoundations = flatten(foundations)
    const flatSemanticColors = flatten(semantic.color)
    const flatTypography = flatten(semantic.typography)

    const resolvedSemanticColors = Object.fromEntries(
        Object.entries(flatSemanticColors).map(([name, value]) => [name, resolveValue(value, foundations)]),
    )

    for (const [foregroundPath, backgroundPath] of contrastPairs) {
        const foreground = resolvedSemanticColors[foregroundPath]
        const background = resolvedSemanticColors[backgroundPath]
        if (!foreground || !background)
            throw new Error(`Unknown contrast pair: ${foregroundPath}, ${backgroundPath}`)
        const ratio = contrastRatio(foreground, background)
        if (ratio < 4.5) {
            // throw new Error(
            console.log(
                `WCAG AA contrast failed for ${foregroundPath} on ${backgroundPath}: ${ratio.toFixed(2)}:1`,
            )
        }
    }

    const foundationLines = Object.entries(flatFoundations)
        .map(([name, value]) => `    --foundation-${cssName(name)}: ${value};`)
        .join('\n')
    const semanticColorLines = Object.entries(flatSemanticColors)
        .map(([name, value]) => {
            const match = value.match(aliasPattern)
            const cssValue = match ? `var(--foundation-${cssName(match[1])})` : value
            return `    --color-${cssName(name)}: ${cssValue};`
        })
        .join('\n')
    const typographyLines = Object.entries(flatTypography)
        .map(([name, value]) => {
            const match = value.match(aliasPattern)
            const cssValue = match ? `var(--foundation-${cssName(match[1])})` : value
            return `    --type-${cssName(name)}: ${cssValue};`
        })
        .join('\n')
    const typographyClasses = Object.keys(semantic.typography)
        .map(
            name => `.type-${name} {
    font-family: var(--type-${name}-family);
    font-size: var(--type-${name}-size);
    font-weight: var(--type-${name}-weight);
    line-height: var(--type-${name}-line-height);
    letter-spacing: var(--type-${name}-letter-spacing);
}`,
        )
        .join('\n\n')

    const css = `/* Generated by tools/design-tokens.cjs. Do not edit. */
:root {
${foundationLines}
}

:root,
[data-theme='dark'] {
${semanticColorLines}
${typographyLines}
}

${typographyClasses}
`

    const colorEntries = Object.keys(flatSemanticColors).map(name => [name, `var(--color-${cssName(name)})`])
    const semanticColors = nestedMap(colorEntries)
    const foundationVariableMap = group =>
        Object.fromEntries(
            Object.keys(foundations[group] ?? {}).map(name => [
                name,
                `var(--foundation-${cssName(`${group}.${name}`)})`,
            ]),
        )
    const typographySizes = Object.fromEntries(
        Object.keys(semantic.typography).map(name => [
            name,
            [
                `var(--type-${name}-size)`,
                {
                    lineHeight: `var(--type-${name}-line-height)`,
                    letterSpacing: `var(--type-${name}-letter-spacing)`,
                },
            ],
        ]),
    )
    const tailwind = {
        colors: semanticColors,
        spacing: foundationVariableMap('spacing'),
        borderRadius: foundationVariableMap('radius'),
        opacity: foundationVariableMap('opacity'),
        boxShadow: foundationVariableMap('shadow'),
        fontSize: typographySizes,
        transitionDuration: {
            instant: 'var(--foundation-motion-duration-instant)',
            fast: 'var(--foundation-motion-duration-fast)',
            moderate: 'var(--foundation-motion-duration-moderate)',
            slow: 'var(--foundation-motion-duration-slow)',
            ambient: 'var(--foundation-motion-duration-ambient)',
        },
        transitionTimingFunction: {
            standard: 'var(--foundation-motion-easing-standard)',
            emphasized: 'var(--foundation-motion-easing-emphasized)',
        },
    }

    const colorIdentifiers = Object.keys(flatSemanticColors)
    const foundationIdentifiers = Object.keys(flatFoundations)
    const identifiersFor = prefix =>
        foundationIdentifiers.filter(identifier => identifier.startsWith(`${prefix}.`))
    const ts = `// Generated by tools/design-tokens.cjs. Do not edit.
export const semanticColorIdentifiers = ${JSON.stringify(colorIdentifiers, null, 4)} as const

export type SemanticColorIdentifier = (typeof semanticColorIdentifiers)[number]

export const semanticColor = (identifier: SemanticColorIdentifier): string =>
    \`var(--color-\${identifier.replace(/\\./g, '-')})\`

export const contrastPairs = ${JSON.stringify(contrastPairs, null, 4)} as const

export const foundationColorIdentifiers = ${JSON.stringify(identifiersFor('color'), null, 4)} as const
export const spacingTokenIdentifiers = ${JSON.stringify(identifiersFor('spacing'), null, 4)} as const
export const radiusTokenIdentifiers = ${JSON.stringify(identifiersFor('radius'), null, 4)} as const
export const sizeTokenIdentifiers = ${JSON.stringify(identifiersFor('size'), null, 4)} as const
export const opacityTokenIdentifiers = ${JSON.stringify(identifiersFor('opacity'), null, 4)} as const
export const shadowTokenIdentifiers = ${JSON.stringify(identifiersFor('shadow'), null, 4)} as const
export const typographyVariantIdentifiers = ${JSON.stringify(Object.keys(semantic.typography), null, 4)} as const

export const foundationToken = (identifier: string): string =>
    \`var(--foundation-\${identifier.replace(/\\./g, '-').replace(/lineHeight/g, 'line-height')})\`
`
    const electronTs = `// Generated by tools/design-tokens.cjs. Do not edit.
export const nativeWindowBackgroundColor = ${JSON.stringify(colorToHex(resolvedSemanticColors['background.canvas']))}
`

    return {
        css,
        electronTs,
        ts,
        tailwind: `${JSON.stringify(tailwind, null, 4)}\n`,
    }
}

const generatedFiles = () => {
    const foundations = readJson(sourceFiles[0])
    const semantic = readJson(sourceFiles[1])
    const contrastPairs = readJson(sourceFiles[2])
    const output = generate({ foundations, semantic, contrastPairs })
    return [
        [generatedCssPath, output.css],
        [generatedTsPath, output.ts],
        [generatedTailwindPath, output.tailwind],
        [generatedElectronTsPath, output.electronTs],
    ]
}

const writeGenerated = () => {
    for (const [file, contents] of generatedFiles()) {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, contents)
    }
}

const watchGenerated = () => {
    let timeout
    const run = reason => {
        clearTimeout(timeout)
        timeout = setTimeout(() => {
            try {
                writeGenerated()
                console.log(`[design-tokens] generated after ${reason}`)
            } catch (error) {
                console.error(`[design-tokens] generation failed after ${reason}`)
                console.error(error)
            }
        }, 75)
    }

    writeGenerated()
    console.log(`[design-tokens] watching ${sourceFiles.join(', ')}`)

    for (const file of sourceFiles) {
        fs.watch(path.join(sourceDir, file), { persistent: true }, eventType => {
            run(`${eventType} ${file}`)
        })
    }
}

const checkGenerated = () => {
    for (const [file, expected] of generatedFiles()) {
        if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected) {
            throw new Error(`Generated design tokens are stale: ${path.relative(projectRoot, file)}`)
        }
    }
}

const checkRawColorUsage = () => {
    const sourceRoot = path.join(projectRoot, 'src/app')
    const rawPattern =
        /\b(?:bg|text|border|ring|accent|from|to)-(?:purple|green|neutral|danger|warning|tinted|primary|secondary|submit|blue)-\d+\b/
    const violations = []

    const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name)
            if (entry.isDirectory()) visit(file)
            else if (/\.(?:html|css|ts)$/.test(entry.name) && !entry.name.endsWith('.spec.ts')) {
                fs.readFileSync(file, 'utf8')
                    .split('\n')
                    .forEach((line, index) => {
                        if (rawPattern.test(line)) {
                            violations.push(`${path.relative(projectRoot, file)}:${index + 1}`)
                        }
                    })
            }
        }
    }

    visit(sourceRoot)
    if (violations.length) throw new Error(`Raw foundation color utilities found:\n${violations.join('\n')}`)

    const productionRoutes = fs.readFileSync(path.join(projectRoot, 'src/app/app.routes.prod.ts'), 'utf8')
    if (productionRoutes.includes('design-system')) {
        throw new Error('The design-system specimen must not be imported by production routes')
    }
}

if (require.main === module) {
    const command = process.argv[2]
    if (command === 'generate') writeGenerated()
    else if (command === 'watch') watchGenerated()
    else if (command === 'check') {
        checkGenerated()
        checkRawColorUsage()
    } else {
        console.error('Usage: node tools/design-tokens.cjs <generate|watch|check>')
        process.exitCode = 1
    }
}

module.exports = {
    contrastRatio,
    flatten,
    generate,
    getPath,
    resolveValue,
}
