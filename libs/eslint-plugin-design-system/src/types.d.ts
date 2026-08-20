type ClassCheckerOptions = import('./lib/class-checker.cjs').ClassCheckerOptions

/**
 * Types for the two surfaces that cannot simply be imported.
 *
 * **Tailwind.** `tailwindcss` ships declarations for a handful of top-level entry points
 * (`resolveConfig`, `plugin`, …) and none at all under `lib/`. `lib/lib/generateRules` and
 * `lib/lib/setupContextUtils` are internal, untyped, and unavoidable: asking Tailwind's own resolver
 * whether a class emits CSS is the whole design, and there is no public API that answers it.
 *
 * **The Angular AST.** Here the classes *are* importable, so everything below is derived from them
 * rather than restated — a field renamed in Angular fails this build. What cannot be imported is the
 * shape ESLint sees, because `@angular-eslint/template-parser` rewrites the AST before walking it:
 * `preprocessNode` stamps `type = node.constructor.name` on every node, and where Angular already
 * used `type` for something else — `TmplAstBoundAttribute.type` is a numeric `BindingType` — it
 * moves the original to `__originalType` and overwrites it. So the compiler's declarations describe
 * the shape *before* that rewrite, and the parser's own exported node type is
 * `{ [key: string]: any; type: any }`. `Stamped` is exactly the difference between the two.
 *
 * Angular types are referenced with inline `import(...)` rather than a top-level `import type`,
 * which would turn this file into a module and take the declarations below out of global scope.
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

/**
 * Everything the Angular compiler exports.
 *
 * `@angular/compiler` rather than `@angular-eslint/bundled-angular-compiler`, which is where the
 * runtime nodes actually come from: the bundled package is `export * from '@angular/compiler'`, so
 * the declarations are identical, and only `@angular/compiler` is a declared top-level dependency.
 * The bundled one is hoisted by npm on some installs and nested under its dependents on others —
 * resolving it from here worked locally and not in CI, which is not a thing to leave to luck.
 */
type NgCompiler = typeof import('@angular/compiler')

/**
 * That import failing is a silent failure worth understanding, because it has already happened
 * once. `skipLibCheck` suppresses the "cannot find module" error *inside this file*, the types
 * below all degrade, and the only symptom is a lone `implicitly has an 'any' type` on the first
 * inferred callback parameter in `lib/expression-classes.cjs` — a file with nothing wrong with it.
 *
 * There is no type-level canary for it: an unresolved module produces TypeScript's error type,
 * which is assignable to everything and is not detected by the usual `0 extends 1 & T` test for
 * `any`. So the check is a runtime one in the corpus, asserting that the package these types name
 * is resolvable from this library — which is the property that actually broke.
 */

/** A compiler node as the parser hands it on: its own shape, with `type` replaced by the class name. */
type Stamped<TNode, TName extends string> = Omit<TNode, 'type'> & { type: TName }

/**
 * An expression node the rules walk.
 *
 * Open rather than a union discriminated on `type`, because the vocabulary is the Angular
 * compiler's and the rules recognise only part of it — anything else is unresolvable and reported,
 * which a closed union cannot express without a `{ type: string }` catch-all that would defeat
 * narrowing on every other member. The members still come from the real classes, so this is a view
 * of the AST rather than a second description of it.
 */
interface AngularExpression {
    /** `constructor.name` of the compiler class the parser stamped on. */
    type: string
    span?: InstanceType<NgCompiler['AST']>['span']
    sourceSpan?: InstanceType<NgCompiler['AST']>['sourceSpan']
    /** `ASTWithSource` */
    ast?: AngularExpression
    /** `LiteralPrimitive` */
    value?: InstanceType<NgCompiler['LiteralPrimitive']>['value']
    /** `Binary` */
    operation?: InstanceType<NgCompiler['Binary']>['operation']
    left?: AngularExpression
    right?: AngularExpression
    /** `Conditional` */
    trueExp?: AngularExpression
    falseExp?: AngularExpression
    /** `Interpolation` */
    strings?: InstanceType<NgCompiler['Interpolation']>['strings']
    /** `LiteralMap` — the entries are a union; only the `property` kind carries a `key`. */
    keys?: InstanceType<NgCompiler['LiteralMap']>['keys']
    /** `LiteralArray` */
    expressions?: AngularExpression[]
    /** `PropertyRead`, `SafePropertyRead` */
    name?: InstanceType<NgCompiler['PropertyRead']>['name']
    /** `Call`, `SafeCall`, `KeyedRead`, `SafeKeyedRead`, and the property reads */
    receiver?: AngularExpression
}

/** `<div class="…">` — a static attribute. */
type AngularTextAttribute = Stamped<InstanceType<NgCompiler['TmplAstTextAttribute']>, 'TextAttribute'>

/** `<div [class]="…">`, `[ngClass]`, `[class.foo]`. */
type AngularBoundAttribute = Stamped<InstanceType<NgCompiler['TmplAstBoundAttribute']>, 'BoundAttribute'> & {
    /** Angular's own numeric `type`, displaced by the parser's stamp. `2` is `[class.foo]`. */
    __originalType?: NgCompiler['BindingType'][keyof NgCompiler['BindingType']]
    value: AngularExpression
}
