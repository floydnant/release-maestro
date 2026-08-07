import { formatTotalDuration } from './formatting.utils'

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
