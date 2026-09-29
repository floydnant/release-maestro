import type { BrowseWindow } from '@release-maestro/core'

/** Fixed geometry shared by track tables and catalog lists. See ADR 0004. */
export const LIST_ROW_HEIGHT = 40
export const GROUPED_SONG_ROW_HEIGHT = 64
const OVERSCAN_ROWS = 20

/** Pages seed the first query here so restoring scroll does not fetch an unused window at the top. */
export const listWindowOffsetAt = (scrollTop: number, rowHeight = LIST_ROW_HEIGHT): number =>
    Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS)

export const listWindowAt = (
    scrollTop: number,
    viewportHeight: number,
    rowHeight = LIST_ROW_HEIGHT,
): BrowseWindow => ({
    offset: listWindowOffsetAt(scrollTop, rowHeight),
    limit: Math.ceil(viewportHeight / rowHeight) + OVERSCAN_ROWS * 2,
})
