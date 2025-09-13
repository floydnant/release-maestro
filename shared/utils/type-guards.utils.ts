export const isTruthy = <T>(value: T | undefined | null | false | 0 | ''): value is T => Boolean(value)

class ReachedUnreachableCodeException extends Error {
    constructor(
        message: string,
        public value: unknown,
    ) {
        super(message)
    }
}

export const assertUnreachable = (value: never, message?: string): never => {
    throw new ReachedUnreachableCodeException(
        (message || 'Reached unreachable point in the code with value:') + ' ' + JSON.stringify(value),
        value,
    )
}
