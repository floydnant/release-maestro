import type { BrowseWindow } from '@release-maestro/core'

/** Geometry shared by windowed lists. Group starts are sorted song indexes, not extra rows. */
export const LIST_ROW_HEIGHT = 40
export const LIST_GROUP_HEADER_HEIGHT = 24
const OVERSCAN_ROWS = 20

/** A group header consumes space only at its boundary. Memory stays proportional to groups. */
export const listRowTop = (index: number, groupStarts: readonly number[] = []): number => {
    let headers = 0
    for (const start of groupStarts) {
        if (start >= index) break
        headers += 1
    }
    return index * LIST_ROW_HEIGHT + headers * LIST_GROUP_HEADER_HEIGHT
}

export const listIndexAt = (scrollTop: number, groupStarts: readonly number[] = []): number => {
    let headers = 0
    for (const start of groupStarts) {
        const headerTop = start * LIST_ROW_HEIGHT + headers * LIST_GROUP_HEADER_HEIGHT
        if (scrollTop < headerTop) break
        headers += 1
        if (scrollTop < headerTop + LIST_GROUP_HEADER_HEIGHT) return start
    }
    return Math.max(0, Math.floor((scrollTop - headers * LIST_GROUP_HEADER_HEIGHT) / LIST_ROW_HEIGHT))
}

/** Pages seed the first query here so restoring scroll does not fetch an unused window at the top. */
export const listWindowOffsetAt = (scrollTop: number, groupStarts: readonly number[] = []): number =>
    Math.max(0, listIndexAt(scrollTop, groupStarts) - OVERSCAN_ROWS)

export const listWindowAt = (
    scrollTop: number,
    viewportHeight: number,
    groupStarts: readonly number[] = [],
): BrowseWindow => ({
    offset: listWindowOffsetAt(scrollTop, groupStarts),
    limit: Math.ceil(viewportHeight / LIST_ROW_HEIGHT) + OVERSCAN_ROWS * 2,
})
