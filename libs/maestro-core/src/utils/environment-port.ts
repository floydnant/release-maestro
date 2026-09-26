export const parseEnvironmentPort = (name: string, value: string | undefined, fallback: number): number => {
    if (value === undefined) return fallback
    if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer from 1024 to 65535`)
    const port = Number(value)
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
        throw new Error(`${name} must be an integer from 1024 to 65535`)
    }
    return port
}
