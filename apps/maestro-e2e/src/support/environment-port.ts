import { parseEnvironmentPort } from '@release-maestro/core'

export const environmentPort = (name: string, fallback: number): number => {
    return parseEnvironmentPort(name, process.env[name], fallback)
}
