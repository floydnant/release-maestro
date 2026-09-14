import type { BrowseWindow } from '@release-maestro/core'

/** Fixed geometry shared by track tables and catalog lists. See ADR 0004. */
export const LIST_ROW_HEIGHT = 40
const OVERSCAN_ROWS = 20

/** Pages seed the first query here so restoring scroll does not fetch an unused window at the top. */
export const listWindowOffsetAt = (scrollTop: number): number =>
    Math.max(0, Math.floor(scrollTop / LIST_ROW_HEIGHT) - OVERSCAN_ROWS)

export const listWindowAt = (scrollTop: number, viewportHeight: number): BrowseWindow => ({
    offset: listWindowOffsetAt(scrollTop),
    limit: Math.ceil(viewportHeight / LIST_ROW_HEIGHT) + OVERSCAN_ROWS * 2,
})
