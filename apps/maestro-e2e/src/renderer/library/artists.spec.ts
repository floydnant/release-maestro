import { expect, test } from '@playwright/test'
import type { ArtistDetail, ArtistRow, QueryArtistsRequest } from '@release-maestro/core'
import { createAlbumRow, createRendererScenario, createSongRow, scenarioBuilder } from '../scenario-harness'

const artist: ArtistDetail = {
    id: 'aurora',
    name: 'Aurora Fields',
    songCount: 3,
    albumCount: 1,
    firstYear: 2019,
    lastYear: 2021,
    appearanceCount: 1,
    recordLabelCount: 1,
    externalRefs: { MUSICBRAINZ_ARTIST_ID: ['some-id'] },
}
const rows: ArtistRow[] = [
    artist,
    {
        id: 'compound',
        name: 'Night Cartel & Aurora Fields',
        songCount: 1,
        albumCount: 0,
        firstYear: 2021,
        lastYear: 2021,
    },
]
const window = { rows, offset: 0, total: rows.length }

const scenario = () =>
    scenarioBuilder()
        .handler('library:query-artists', { kind: 'resolve', value: window })
        .handler('library:get-artist-detail', { kind: 'resolve', value: artist })
        .handler('library:query-artist-record-labels', {
            kind: 'resolve',
            value: {
                rows: [{ id: 'kosmische', name: 'Kosmische' }],
                offset: 0,
                total: 1,
            },
        })
        .handler('library:query-albums', {
            kind: 'resolve',
            value: {
                rows: [createAlbumRow({ id: 'daybreak', title: 'Daybreak' })],
                offset: 0,
                total: 1,
            },
        })
        .songs([
            createSongRow({
                title: 'Dawn',
                artistCredit: [{ artistId: 'aurora', creditedAs: 'Aurora Fields', joinPhrase: '' }],
            }),
        ])

test('artist list filters, sorts and shows derived stats', async ({ page }) => {
    const controller = await createRendererScenario(page, scenario().build(), '/artists')
    const list = page.getByRole('region', { name: 'Artists', exact: true })
    await expect(list.getByRole('link', { name: /^Aurora Fields/ })).toContainText('3 tracks')
    await expect(list.getByRole('link', { name: /^Aurora Fields/ })).toContainText('1 album')
    await expect(list.getByRole('link', { name: /^Aurora Fields/ })).toContainText(/2019\s*–2021/)
    await expect(list.getByRole('link', { name: /^Night Cartel & Aurora Fields/ })).toBeVisible()
    await page.getByRole('button', { name: 'Sort artists Z to A' }).click()
    await expect
        .poll(
            async () => (await controller.lastCall('library:query-artists'))?.payload as QueryArtistsRequest,
        )
        .toMatchObject({ query: { sort: { direction: 'desc' } } })
    await page.getByRole('searchbox', { name: 'Search artists' }).fill('Aurora')
    await expect
        .poll(
            async () => (await controller.lastCall('library:query-artists'))?.payload as QueryArtistsRequest,
        )
        .toMatchObject({ query: { search: 'Aurora' } })
})

test('artist detail has four distinct sections', async ({ page }) => {
    const controller = await createRendererScenario(page, scenario().build(), '/artists/aurora')
    await expect(page.getByRole('heading', { name: 'Aurora Fields' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'MusicBrainz' })).toHaveAttribute(
        'href',
        'https://musicbrainz.org/artist/some-id',
    )
    await expect(
        page.getByRole('grid', { name: 'Albums' }).getByRole('link', { name: /^Daybreak/ }),
    ).toBeVisible()
    await expect
        .poll(async () => (await controller.lastCall('library:query-albums'))?.payload)
        .toMatchObject({ query: { filter: { albumArtistIds: ['aurora'] } } })
    await page.getByRole('link', { name: 'All tracks 3' }).click()
    await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()
    await expect
        .poll(async () => (await controller.lastCall('library:query-songs'))?.payload)
        .toMatchObject({ query: { filter: { artistIds: ['aurora'] } } })
    await page.getByRole('link', { name: 'Released on record labels 1' }).click()
    await expect(
        page.getByRole('region', { name: 'Record labels' }).getByRole('link', { name: 'Kosmische' }),
    ).toBeVisible()
    await expect
        .poll(async () => (await controller.lastCall('library:query-artist-record-labels'))?.payload)
        .toMatchObject({ artistId: 'aurora' })
    await page.getByRole('link', { name: 'Appears on 1' }).click()
    await expect(page.getByRole('grid', { name: 'Albums' })).toBeVisible()
    await expect
        .poll(async () => (await controller.lastCall('library:query-albums'))?.payload)
        .toMatchObject({ query: { appearanceArtistId: 'aurora', filter: {} } })
})

test('a stored Bandcamp artist ID offers an honest search link', async ({ page }) => {
    await createRendererScenario(
        page,
        scenario()
            .handler('library:get-artist-detail', {
                kind: 'resolve',
                value: {
                    ...artist,
                    externalRefs: { BANDCAMP_ARTIST_ID: ['12345'] },
                },
            })
            .build(),
        '/artists/aurora',
    )
    await expect(page.getByRole('link', { name: 'Search Bandcamp' })).toHaveAttribute(
        'href',
        'https://bandcamp.com/search?q=Aurora%20Fields',
    )
})

test('named service links only open the matching service host', async ({ page }) => {
    await createRendererScenario(
        page,
        scenario()
            .handler('library:get-artist-detail', {
                kind: 'resolve',
                value: {
                    ...artist,
                    externalRefs: {
                        DISCOGS_ARTIST_LINK: ['https://example.com/artist/123'],
                        BEATPORT_ARTIST_URL: ['https://www.beatport.com/artist/aurora/123'],
                    },
                },
            })
            .build(),
        '/artists/aurora',
    )
    await expect(page.getByRole('link', { name: 'Discogs' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Beatport' })).toHaveAttribute(
        'href',
        'https://www.beatport.com/artist/aurora/123',
    )
})

test('an artist with tracks but no own albums opens on All tracks', async ({ page }) => {
    await createRendererScenario(
        page,
        scenario()
            .handler('library:get-artist-detail', {
                kind: 'resolve',
                value: {
                    ...artist,
                    id: 'compound',
                    name: 'Night Cartel & Aurora Fields',
                    albumCount: 0,
                    songCount: 1,
                    firstYear: 2021,
                    lastYear: 2021,
                    appearanceCount: 1,
                    recordLabelCount: 0,
                },
            })
            .build(),
        '/artists/compound',
    )
    await expect(page.getByRole('heading', { name: 'Night Cartel & Aurora Fields' })).toBeVisible()
    await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'All tracks 1' })).toHaveAttribute('aria-current', 'page')
})

test('record-label navigation keeps the artist filter', async ({ page }) => {
    await createRendererScenario(page, scenario().build(), '/artists/aurora?section=recordLabels')
    await page.getByRole('region', { name: 'Record labels' }).getByRole('link', { name: 'Kosmische' }).click()
    await expect(page).toHaveURL(/\/albums\?.*recordLabel=kosmische.*albumArtist=aurora/)
})

test('a co-artist credit opens that artist', async ({ page }) => {
    await createRendererScenario(
        page,
        scenario()
            .songs([
                createSongRow({
                    title: 'Together',
                    artistText: 'Night Cartel & Aurora Fields',
                    artistCredit: [
                        { artistId: 'compound', creditedAs: 'Night Cartel & Aurora Fields', joinPhrase: '' },
                    ],
                }),
            ])
            .build(),
        '/artists/aurora?section=songs',
    )
    await page.getByRole('button', { name: 'Night Cartel & Aurora Fields' }).click()
    await expect(page).toHaveURL(/\/artists\/compound$/)
})
