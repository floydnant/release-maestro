import { Observable, tap, TapObserver } from 'rxjs'

export const keysOf = <TObj extends Record<string, unknown>>(obj: TObj): (keyof TObj)[] => {
    return Object.keys(obj)
}

export type ValueOf<T extends object> = T[keyof T]
export const valuesOf = <TObj extends Record<string, unknown>>(obj: TObj): ValueOf<TObj>[] => {
    return Object.values(obj) as ValueOf<TObj>[]
}

export type EntryOf<T extends object> = {
    [K in keyof T]: [K, T[K]]
}[keyof T]
export const entriesOf = <TObj extends Record<string, unknown>>(obj: TObj): EntryOf<TObj>[] => {
    return Object.entries(obj) as EntryOf<TObj>[]
}

export type Prettify<T extends object> = {
    [K in keyof T]: T[K]
} & {}

export type Unwrap<T> = T extends Promise<infer U> ? U : T extends Observable<infer U> ? U : T

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cons<H, T> = T extends readonly any[]
    ? ((h: H, ...t: T) => void) extends (...r: infer R) => void
        ? R
        : never
    : never

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, ...0[]]

/** Get a union of tuples containing all possible key paths in `T` */
export type PathsTuples<T, D extends number = 10> = [D] extends [never]
    ? never
    : T extends object
      ? {
            [K in keyof T]-?:
                | [K]
                | (PathsTuples<T[K], Prev[D]> extends infer P ? (P extends [] ? never : Cons<K, P>) : never)
        }[keyof T]
      : []

type Join<TKey, TSeparator extends string, P> = TKey extends string | number
    ? P extends string | number
        ? `${TKey}${'' extends P ? '' : TSeparator}${P}`
        : never
    : never

/** Similar to `PathsTuples` but keys concatenated with `S` instead of tuples. */
export type PathsConcatenated<T, S extends string = '.', D extends number = 10> = [D] extends [never]
    ? never
    : T extends object
      ? {
            [K in keyof T]-?: K extends string | number
                ? `${K}` | Join<K, S, PathsConcatenated<T[K], S, Prev[D]>>
                : never
        }[keyof T]
      : ''

/** Get a union of all nested keys of `T` concatenated with `S`. (similar to `Paths` but only deep key paths) */
export type LeavesConcatenated<T, S extends string = '.', D extends number = 10> = [D] extends [never]
    ? never
    : T extends object
      ? { [K in keyof T]-?: Join<K, S, LeavesConcatenated<T[K], S, Prev[D]>> }[keyof T]
      : ''

export const fulfilledOrNull = <T>(result: PromiseSettledResult<T>): T | null => {
    return result.status === 'fulfilled' ? result.value : null
}

export const debugObserver = <T>(
    name: string,
    {
        subscribe = true,
        unsubscribe = true,
        next = true,
        error = true,
        complete = true,
        finalize = false,
    }: Partial<Record<keyof TapObserver<unknown>, boolean>> = {} as never,
) =>
    tap<T>({
        subscribe: !subscribe
            ? undefined
            : () => console.log(`🧩 %csubscribed to %c${name}`, 'color:gray', ''),
        unsubscribe: !unsubscribe
            ? undefined
            : () => console.log(`👋 %cunsubscribed from %c${name}`, 'color:gray', ''),
        next: !next ? undefined : value => console.log(`🚀 %cnext %c${name}`, 'color:gray', '', value),
        error: !error ? undefined : error => console.log(`🚨 %cerror %c${name}`, 'color:gray', '', error),
        complete: !complete ? undefined : () => console.log(`✅ %ccomplete %c${name}`, 'color:gray', ''),
        finalize: !finalize ? undefined : () => console.log(`🏁 %cfinalize %c${name}`, 'color:gray', ''),
    })
