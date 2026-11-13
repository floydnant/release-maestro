import type { PrescanFileFact } from '@release-maestro/core'
import { basename } from 'node:path'

export const newPrescanFactFixture = (
    path: string,
    overrides: Partial<PrescanFileFact> = {},
): PrescanFileFact => ({
    path,
    fileName: basename(path),
    size: 1_024,
    modifiedAt: 1_000,
    createdAt: 500,
    ...overrides,
})
