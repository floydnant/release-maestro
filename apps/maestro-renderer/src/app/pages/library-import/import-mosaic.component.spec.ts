import { LibraryAlbumPreview } from '@release-maestro/core'
import { sampleMovingBacklog } from './import-mosaic.component'

const album = (index: number): LibraryAlbumPreview => ({
    albumTitle: `Album ${index}`,
    artist: `Artist ${index}`,
    coverPath: `/covers/${index}.jpg`,
})

describe(sampleMovingBacklog.name, () => {
    it('keeps a small backlog in arrival order', () => {
        const pending = [album(0), album(1)]
        const arrived = [album(2), album(3)]

        expect(sampleMovingBacklog(pending, arrived).map(item => item.coverPath)).toEqual([
            '/covers/0.jpg',
            '/covers/1.jpg',
            '/covers/2.jpg',
            '/covers/3.jpg',
        ])
    })

    it('samples a bounded backlog near the latest scan cursor', () => {
        const pending = Array.from({ length: 24 }, (_, index) => album(index))
        const arrived = Array.from({ length: 200 }, (_, index) => album(index + 24))

        const sampled = sampleMovingBacklog(pending, arrived, () => 0)
        const sampledIndexes = sampled.map(item => Number.parseInt(item.coverPath.match(/\d+/)?.[0] ?? '-1'))

        expect(sampled).toHaveLength(24)
        expect(Math.min(...sampledIndexes)).toBeGreaterThanOrEqual(128)
        expect(sampled.at(-1)?.coverPath).toBe('/covers/223.jpg')
    })
})
