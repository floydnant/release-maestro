import { entriesOf } from '@release-maestro/core'

export const formatDuration = (duration: number): string => {
    // If the duration is longer than 10 hours, its probably in milliseconds
    if (duration > 3600 * 10) {
        duration = duration / 1000
    }

    let str = ''

    const hours = Math.floor(duration / 3600) || 0
    if (hours) str += hours + ':'

    const minutes = Math.floor((duration % 3600) / 60) || 0
    if (hours) str += minutes.toString().padStart(2, '0')
    else str += minutes

    const seconds = Math.floor(duration % 60) || 0
    str += ':' + seconds.toString().padStart(2, '0')

    return str
}

/**
 * A running time in words — `1 hr 10 min`, `47 min`, `38 sec`.
 *
 * For a *sum* of durations rather than one of them. `1:10:30` is a timecode: it reads
 * as a position in something playing, and the seconds in it are noise when the figure
 * describes a whole record. A track's own duration keeps {@link formatDuration}, where
 * the colon form is exactly right and the seconds are the point.
 *
 * Seconds in, matching `songs.duration` and the totals summed from it. Deliberately
 * without {@link formatDuration}'s milliseconds heuristic: a total crosses ten hours
 * legitimately — a boxed set does it on its own — and guessing at the unit there would
 * report a twelve-hour compilation as three quarters of a minute.
 */
export const formatTotalDuration = (duration: number): string => {
    const total = Math.max(0, Math.round(duration))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)

    if (hours && minutes) return `${hours} hr ${minutes} min`
    if (hours) return `${hours} hr`
    if (minutes) return `${minutes} min`
    return `${total} sec`
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
/** to millis i.e. `<unit> * <factor> = milliseconds` */
const conversionFactorMap = {
    year: 24 * 60 * 60 * 1000 * 365,
    month: (24 * 60 * 60 * 1000 * 365) / 12,
    week: 24 * 60 * 60 * 1000 * 7,
    day: 24 * 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    minute: 60 * 1000,
    second: 1000,
} satisfies Partial<Record<Intl.RelativeTimeFormatUnit, number>>
const conversionFactorEntries = entriesOf(conversionFactorMap)

export const formatDateRelative = (date: Date, referenceDate: Date = new Date()): string => {
    const difference = date.valueOf() - referenceDate.valueOf()

    // Get the unit that is the most significant
    // i.e. the first unit where the difference is greater than the conversion factor to millis
    // or second if the difference is less than a second
    const [unit, conversionFactor] = conversionFactorEntries.find(([, conversionFactor]) => {
        return Math.abs(difference) > conversionFactor
    }) || ['second', 1000]

    // The difference in the unit we previously selected
    const roundedDifference = Math.round(difference / conversionFactor)

    return relativeTimeFormatter.format(roundedDifference, unit)
}

const shortDateFormatter = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' })

/**
 * An absolute short date, for table columns where rows are compared against each
 * other rather than against now — "12 Mar 2024" sorts and scans; "8 months ago"
 * does neither.
 */
export const formatDateShort = (date: Date | number): string => shortDateFormatter.format(date)

/**
 * BPM to at most one decimal. Analysis tools write `128`, `128.0` and `127.996` for
 * the same track, and a column of those is unreadable.
 */
export const formatBpm = (bpm: number | null): string => {
    if (bpm == null || !Number.isFinite(bpm)) return ''
    return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1)
}

/** Split a filesystem path into the dimmable parent portion (incl. trailing separator) and the base name. */
export const splitPathBaseName = (path: string): { parent: string; base: string } => {
    const trimmed = path.replace(/[/\\]+$/, '')
    const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
    if (index < 0) return { parent: '', base: trimmed }
    return { parent: trimmed.slice(0, index + 1), base: trimmed.slice(index + 1) }
}
