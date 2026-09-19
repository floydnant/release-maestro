import { tralbumDataAttrSchema } from './bandcamp-api.schema'

describe('Bandcamp release dates', () => {
    it.each([
        ['19 Sep 2026 00:00:00 GMT', '2026-09-19'],
        ['19 Sep 2026 00:00:00 +1400', '2026-09-19'],
        ['Sat, 19 Sep 2026 23:59:59 -1200', '2026-09-19'],
        ['2026-09-19T00:00:00+14:00', '2026-09-19'],
        ['2026-09-19T23:59:59-12:00', '2026-09-19'],
        ['2026-09-19', '2026-09-19'],
        ['29 Feb 2024 00:00:00 GMT', '2024-02-29'],
        ['29 Feb 2026 00:00:00 GMT', null],
        ['2026-02-30T00:00:00Z', null],
        ['19 Nope 2026 00:00:00 GMT', null],
        ['not a date', null],
        ['', null],
        [null, null],
        [undefined, undefined],
    ])('preserves the source calendar day of %s', (source, expected) => {
        expect(tralbumDataAttrSchema.shape.album_release_date.parse(source)).toBe(expected)
        expect(tralbumDataAttrSchema.shape.current.shape.release_date.parse(source)).toBe(expected)
    })
})
