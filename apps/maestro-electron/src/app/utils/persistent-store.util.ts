/**
 * Minimal persistent key-value store surface, implemented in production by `conf`
 * (see di.ts). Services depend on this interface instead of importing `conf`
 * directly: `conf` is ESM-only, which the jest/ts-jest CommonJS pipeline cannot
 * load, so keeping it out of service modules makes them unit-testable.
 */
export interface PersistentStore<T extends Record<string, unknown>> {
    store: T
    get<K extends keyof T>(key: K): T[K]
    set<K extends keyof T>(key: K, value: T[K]): void
    clear(): void
    readonly path: string
}

/** In-memory drop-in used by unit tests. */
export class InMemoryStore<T extends Record<string, unknown>> implements PersistentStore<T> {
    readonly path = '(in-memory)'

    constructor(public store: T = {} as T) {}

    get<K extends keyof T>(key: K): T[K] {
        return this.store[key]
    }

    set<K extends keyof T>(key: K, value: T[K]): void {
        this.store = { ...this.store, [key]: value }
    }

    clear(): void {
        this.store = {} as T
    }
}
