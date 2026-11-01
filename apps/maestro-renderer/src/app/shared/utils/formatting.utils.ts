import { CalendarDay, entriesOf } from '@release-maestro/core'

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

/** The viewer's local calendar day of a timestamp, as that day's UTC midnight so day arithmetic never meets a DST change. */
const localCalendarDay = (date: Date): Date =>
    new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))

/** A calendar day as its UTC midnight, comparable with {@link localCalendarDay}. */
const calendarDayDate = (date: CalendarDay): Date => new Date(`${date}T00:00:00Z`)

/**
 * The distance from one calendar day to another in the largest whole unit — `today`, `16d ago`,
 * `in 7d`, `2mo ago`, `1y ago`. Days until a whole calendar month has passed, then whole months until a
 * whole year has. No week unit, so 16 days stays `16d`; whole years round down, so 23 months is `1y`.
 * Both days are UTC midnights from {@link localCalendarDay} or {@link calendarDayDate}.
 */
const formatCalendarDayDistance = (date: Date, referenceDay: Date): string => {
    const days = Math.round((date.valueOf() - referenceDay.valueOf()) / conversionFactorMap.day)
    if (days === 0) return 'today'

    const [earlier, later] = days > 0 ? [referenceDay, date] : [date, referenceDay]
    const months =
        (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 +
        later.getUTCMonth() -
        earlier.getUTCMonth() -
        (later.getUTCDate() < earlier.getUTCDate() ? 1 : 0)
    const amount =
        months < 1 ? `${Math.abs(days)}d` : months < 12 ? `${months}mo` : `${Math.floor(months / 12)}y`

    return days > 0 ? `in ${amount}` : `${amount} ago`
}

const shortMonthFormatter = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' })

/**
 * Bandcamp's release day with its distance from the viewer's current calendar day —
 * `released Oct 7 (16d ago)`, `releases Oct 30 (in 7d)`, `released Mar 5 2025 (1y ago)`. The year
 * appears only outside the viewer's current year. A release on the current day `releases … (today)`.
 */
export const formatReleaseDate = (date: CalendarDay, referenceDate: Date = new Date()): string => {
    const day = calendarDayDate(date)
    const today = localCalendarDay(referenceDate)
    const verb = day.valueOf() < today.valueOf() ? 'released' : 'releases'
    const year = day.getUTCFullYear() === today.getUTCFullYear() ? '' : ` ${day.getUTCFullYear()}`
    return `${verb} ${shortMonthFormatter.format(day)} ${day.getUTCDate()}${year} (${formatCalendarDayDistance(day, today)})`
}

/** A timestamp's distance from now at calendar-day precision in the viewer's timezone — `today`, `20d ago`. */
export const formatCalendarDateRelative = (date: Date, referenceDate: Date = new Date()): string =>
    formatCalendarDayDistance(localCalendarDay(date), localCalendarDay(referenceDate))

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
