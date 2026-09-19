import { formatDateRelative, formatReleaseDateRelative, formatTotalDuration } from './formatting.utils'

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

describe('formatReleaseDateRelative', () => {
    it.each([
        ['2026-09-19T00:00:00', '2026-09-19T23:59:59', 'releases today'],
        ['2026-09-19T23:59:59', '2026-09-19T00:00:00', 'releases today'],
        ['2026-09-19T12:00:00', '2026-09-19T12:00:00', 'releases today'],
        ['2026-09-20T00:00:00', '2026-09-19T23:59:59', 'releases tomorrow'],
        ['2026-09-20T23:59:59', '2026-09-19T00:00:00', 'releases tomorrow'],
        ['2026-09-18T23:59:59', '2026-09-19T00:00:00', 'released yesterday'],
        ['2026-09-18T00:00:00', '2026-09-19T23:59:59', 'released yesterday'],
        ['2027-01-01T00:00:00', '2026-12-31T23:59:59', 'releases tomorrow'],
        ['2024-03-01T00:00:00', '2024-02-29T23:59:59', 'releases tomorrow'],
        ['2026-09-21T00:00:00', '2026-09-19T23:59:59', 'releases in 2 days'],
        ['2026-09-17T23:59:59', '2026-09-19T00:00:00', 'released 2 days ago'],
        ['2026-10-03T12:00:00', '2026-09-19T12:00:00', 'releases in 2 weeks'],
        ['2026-09-05T12:00:00', '2026-09-19T12:00:00', 'released 2 weeks ago'],
        // These span the spring and autumn clock changes in Europe/Berlin.
        ['2026-03-30T00:00:00', '2026-03-28T23:59:59', 'releases in 2 days'],
        ['2026-10-26T00:00:00', '2026-10-24T23:59:59', 'releases in 2 days'],
    ])('formats %s relative to %s as %s', (releaseDate, referenceDate, expected) => {
        expect(formatReleaseDateRelative(new Date(releaseDate), new Date(referenceDate))).toBe(expected)
    })

    it('uses the current day when the reference date is omitted', () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-09-19T23:59:59'))
        try {
            expect(formatReleaseDateRelative(new Date('2026-09-20T00:00:00'))).toBe('releases tomorrow')
        } finally {
            jest.useRealTimers()
        }
    })
})

describe('formatDateRelative', () => {
    it.each([
        ['2026-09-19T10:00:00', '2 hours ago'],
        ['2026-09-19T11:55:00', '5 minutes ago'],
        ['2026-09-19T11:59:30', '30 seconds ago'],
    ])('preserves timestamp precision for %s', (date, expected) => {
        expect(formatDateRelative(new Date(date), new Date('2026-09-19T12:00:00'))).toBe(expected)
    })
})
