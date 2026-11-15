import { calendarDaySchema } from '@release-maestro/core'
import { formatCalendarDateRelative, formatReleaseDate, formatTotalDuration } from './formatting.utils'

describe('formatTotalDuration', () => {
    it.each([
        [4_230, '1 hr 10 min'],
        [2_820, '47 min'],
        [38, '38 sec'],
        [0, '0 sec'],
    ])('reads %d seconds as %s', (seconds, expected) => {
        expect(formatTotalDuration(seconds)).toBe(expected)
    })

    it('drops the minutes when a total lands on the hour', () => {
        expect(formatTotalDuration(7_200)).toBe('2 hr')
    })

    it('drops the seconds rather than rounding a minute up from them', () => {
        // The figure describes a whole record; 59 seconds of it is noise, and showing
        // "48 min" for 47:59 would disagree with the track list it sits above.
        expect(formatTotalDuration(2_879)).toBe('47 min')
    })

    it('keeps counting hours past ten, where a track duration would assume milliseconds', () => {
        // A boxed set crosses ten hours on its own. `formatDuration`'s unit heuristic
        // would read this as three quarters of a minute.
        expect(formatTotalDuration(43_200)).toBe('12 hr')
    })

    it('reads a fractional total as its nearest second', () => {
        // Durations are summed from a real column, so a total is rarely a whole number.
        expect(formatTotalDuration(2_819.6)).toBe('47 min')
    })
})

// Reference times are local wall-clock strings, so every case reads the same in any timezone.
const today = '2026-10-23T12:00:00'

describe('formatReleaseDate', () => {
    it.each([
        ['2026-10-07', today, 'released Oct 7 (16d ago)'],
        ['2026-10-30', today, 'releases Oct 30 (in 7d)'],
        ['2025-03-05', today, 'released Mar 5 2025 (1y ago)'],
    ])('formats %s relative to %s as %s', (releaseDate, referenceDate, expected) => {
        expect(formatReleaseDate(calendarDaySchema.parse(releaseDate), new Date(referenceDate))).toBe(
            expected,
        )
    })

    it.each([
        // The whole release day is today, from its first second to its last.
        ['2026-10-23', '2026-10-23T00:00:00', 'releases Oct 23 (today)'],
        ['2026-10-23', '2026-10-23T23:59:59', 'releases Oct 23 (today)'],
        ['2026-10-22', '2026-10-23T00:00:00', 'released Oct 22 (1d ago)'],
        ['2026-10-24', '2026-10-23T23:59:59', 'releases Oct 24 (in 1d)'],
    ])('compares %s with the viewer’s calendar day at %s: %s', (releaseDate, referenceDate, expected) => {
        expect(formatReleaseDate(calendarDaySchema.parse(releaseDate), new Date(referenceDate))).toBe(
            expected,
        )
    })

    it.each([
        ['2027-01-01', '2026-12-31T23:59:59', 'releases Jan 1 2027 (in 1d)'],
        ['2027-01-01', '2027-01-01T00:00:00', 'releases Jan 1 (today)'],
        ['2026-12-31', '2027-01-01T00:00:00', 'released Dec 31 2026 (1d ago)'],
    ])('names the year of %s only outside the year at %s: %s', (releaseDate, referenceDate, expected) => {
        expect(formatReleaseDate(calendarDaySchema.parse(releaseDate), new Date(referenceDate))).toBe(
            expected,
        )
    })

    it.each([
        ['2026-09-24', 'released Sep 24 (29d ago)'],
        ['2026-09-23', 'released Sep 23 (1mo ago)'],
        ['2027-01-04', 'releases Jan 4 2027 (in 2mo)'],
        ['2025-10-24', 'released Oct 24 2025 (11mo ago)'],
        ['2025-10-23', 'released Oct 23 2025 (1y ago)'],
        ['2024-10-24', 'released Oct 24 2024 (1y ago)'],
    ])('floors %s to its largest whole unit: %s', (releaseDate, expected) => {
        expect(formatReleaseDate(calendarDaySchema.parse(releaseDate), new Date(today))).toBe(expected)
    })

    it('keeps counting days until a whole calendar month has passed', () => {
        const releaseDate = calendarDaySchema.parse('2026-01-01')
        expect(formatReleaseDate(releaseDate, new Date('2026-01-31T12:00:00'))).toBe(
            'released Jan 1 (30d ago)',
        )
        expect(formatReleaseDate(releaseDate, new Date('2026-02-01T12:00:00'))).toBe(
            'released Jan 1 (1mo ago)',
        )
    })

    it('uses the current day when the reference date is omitted', () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-23T23:59:59'))
        try {
            expect(formatReleaseDate(calendarDaySchema.parse('2026-10-24'))).toBe('releases Oct 24 (in 1d)')
        } finally {
            jest.useRealTimers()
        }
    })
})

describe('formatCalendarDateRelative', () => {
    it.each([
        ['2026-10-03T10:00:00', today, '20d ago'],
        ['2026-10-21T08:00:00', today, '2d ago'],
        ['2026-10-23T00:00:00', '2026-10-23T23:59:59', 'today'],
        ['2026-10-22T23:59:59', '2026-10-23T00:00:00', '1d ago'],
        // Across the European spring clock change, which shortens one of the two days.
        ['2026-03-28T23:59:59', '2026-03-30T00:00:00', '2d ago'],
        ['2025-03-05T10:00:00', today, '1y ago'],
    ])('formats %s relative to %s as %s', (date, reference, expected) => {
        expect(formatCalendarDateRelative(new Date(date), new Date(reference))).toBe(expected)
    })
})
