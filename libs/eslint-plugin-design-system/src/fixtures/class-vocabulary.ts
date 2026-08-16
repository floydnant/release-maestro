/*
 * Fixture for the class-validation rules: not part of the application.
 *
 * Everything here exists on the far side of a module boundary from the component that uses it, which
 * is the point. The syntactic tier of `member-classes.cjs` reads one file and cannot follow any of
 * it; the typed tier resolves all of it through the checker. The corpus asserts both halves.
 */

/** A closed vocabulary as a type alias — no literals anywhere in the component that uses it. */
export type Density = 'gap-1' | 'gap-3'

/** The same vocabulary carrying a name this project's authorities do not know. */
export type PlantedDensity = 'gap-1' | 'gapp-3'

/**
 * Chosen at runtime; only the *type* says what the answers can be. Every member below is
 * initialized through a call rather than a literal on purpose — a literal initializer resolves on
 * the syntactic tier, and these exist to exercise the one behind it.
 */
export function pickDensity(): Density {
    return Math.random() > 0.5 ? 'gap-1' : 'gap-3'
}

/** The same, for the vocabulary with a planted defect in it. */
export function pickPlantedDensity(): PlantedDensity {
    return Math.random() > 0.5 ? 'gap-1' : 'gapp-3'
}

/** No closed set at all — what a member has to look like for `widerMember` to be the verdict. */
export function anyClass(): string {
    return Math.random() > 0.5 ? 'flex' : 'hidden'
}

/** A base class, so an inherited member is a member the component's own file never mentions. */
export abstract class SpecimenBase {
    /** Inherited, and enumerable only through the instance type. */
    readonly inheritedClass: 'panel' | 'badge' = 'panel'
}
