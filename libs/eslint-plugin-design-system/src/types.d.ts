/**
 * Types for the surfaces that have none of their own.
 *
 * Two kinds live here. Tailwind's `lib/lib/*` entry points are internal and ship no declarations —
 * they are the price of asking Tailwind itself whether a class emits CSS, which is the whole design.
 * The Angular template AST is the other: `@angular-eslint/template-parser` hands the rule visitor
 * compiler nodes, and only the handful of fields the rules actually touch are described here.
 * A narrow hand-written shape is deliberate — it fails when a field is renamed under us, which a
 * blanket `any` would not.
 */

declare module 'tailwindcss/lib/lib/setupContextUtils' {
    export interface TailwindContext {
        getClassList(): (string | { name: string })[]
    }

    /** Takes a *resolved* config, which `tailwindcss/resolveConfig` types differently from `Config`. */
    export function createContext(config: object): TailwindContext
}

declare module 'tailwindcss/lib/lib/generateRules' {
    import type { TailwindContext } from 'tailwindcss/lib/lib/setupContextUtils'

    /** Returns one entry per rule Tailwind can build for the candidate; empty means "emits nothing". */
    export function generateRules(candidates: string[], context: TailwindContext): unknown[]
}

/** A character range in the source file, as the Angular compiler reports it. */
interface AngularSpan {
    start: number
    end: number
}

interface AngularParseSpan {
    start: { offset: number }
    end: { offset: number }
}

/**
 * An expression-AST node, as the template parser hands it to a rule visitor.
 *
 * Deliberately one open shape with optional members rather than a union discriminated on `type`.
 * A union would be more precise on paper, but the node vocabulary is the Angular compiler's and it
 * is open-ended — anything the rules do not recognise is treated as unresolvable and reported, so a
 * union would need a `{ type: string }` catch-all, and that catch-all defeats narrowing on every
 * other member. This shape still buys the thing that actually matters: a misspelled field or a
 * misspelled `type` string is a compile error rather than a silently undefined read.
 */
interface AngularExpression {
    type: string
    /** `ASTWithSource` */
    ast?: AngularExpression
    /** `LiteralPrimitive` */
    value?: unknown
    sourceSpan?: AngularSpan
    /** `Binary` */
    operation?: string
    left?: AngularExpression
    right?: AngularExpression
    /** `Conditional` */
    trueExp?: AngularExpression
    falseExp?: AngularExpression
    /** `LiteralMap` */
    keys?: { key: string; quoted?: boolean; sourceSpan?: AngularSpan }[]
    /** `LiteralArray` */
    expressions?: AngularExpression[]
    /** `PropertyRead`, `SafePropertyRead` */
    name?: string
    /** `Call`, `SafeCall`, `KeyedRead`, `SafeKeyedRead`, and the property reads */
    receiver?: AngularExpression
}

/** `<div class="…">` — a static attribute. */
interface AngularTextAttribute {
    name: string
    value: string
    valueSpan?: AngularParseSpan
    sourceSpan: AngularParseSpan
}

/** `<div [class]="…">`, `[ngClass]`, `[class.foo]`. */
interface AngularBoundAttribute {
    name: string
    value: AngularExpression
    keySpan: AngularParseSpan
    sourceSpan: AngularParseSpan
    /** The parser's original `BindingType`; `2` is `[class.foo]`. */
    __originalType?: number
}
