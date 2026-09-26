import { expect, test } from '@playwright/test'
import type { RecordLabelDetail, RecordLabelRow } from '@release-maestro/core'
import { createAlbumRow, createRendererScenario, createSongRow, scenarioBuilder } from '../scenario-harness'

const recordLabel: RecordLabelDetail = {
    id: 'kosmische',
    name: 'Kosmische',
    albumCount: 1,
    songCount: 2,
    artistCount: 1,
    firstYear: 2019,
    lastYear: 2019,
    externalRefs: {
        MUSICBRAINZ_LABEL_ID: ['b00b4a1d-0000-0000-0000-000000000001'],
        BANDCAMP_LABEL_URL: ['https://kosmische.bandcamp.com'],
        DISCOGS_LABEL_LINK: ['http://www.discogs.com/label/1'],
    },
}
const rows: RecordLabelRow[] = [
    recordLabel,
    { ...recordLabel, id: 'saltmarsh', name: 'Saltmarsh', albumCount: 2, firstYear: 2017, lastYear: 2023 },
]
const scenario = () =>
    scenarioBuilder()
        .handler('library:query-record-labels', {
            kind: 'resolve',
            value: { rows, offset: 0, total: rows.length },
        })
        .handler('library:get-record-label-detail', { kind: 'resolve', value: recordLabel })
        .handler('library:query-record-label-artists', {
            kind: 'resolve',
            value: {
                rows: [{ id: 'aurora', name: 'Aurora Fields', hasSongCredits: true }],
                offset: 0,
                total: 1,
            },
        })
        .songs([createSongRow({ title: 'Dawn', recordLabelId: 'kosmische', recordLabelText: 'Kosmische' })])
        .albums([
            createAlbumRow({ title: 'Daybreak', recordLabelId: 'kosmische', recordLabelText: 'Kosmische' }),
        ])

test('record labels list shows stats, search and sort', async ({ page }) => {
    const controller = await createRendererScenario(page, scenario().build(), '/record-labels')
    const list = page.getByRole('region', { name: 'Record labels', exact: true })
    await expect(list.getByRole('link', { name: /^Kosmische/ })).toContainText('2 tracks')
    await expect(list.getByRole('link', { name: /^Saltmarsh/ })).toContainText('2017–2023')
    await page.getByRole('button', { name: 'Sort record labels Z to A' }).click()
    await expect
        .poll(async () => (await controller.lastCall('library:query-record-labels'))?.payload)
        .toMatchObject({ query: { sort: { direction: 'desc' } } })
    await page.getByRole('searchbox', { name: 'Search record labels' }).fill('Salt')
    await expect
        .poll(async () => (await controller.lastCall('library:query-record-labels'))?.payload)
        .toMatchObject({ query: { search: 'Salt' } })
})

test('record label detail shows tracks, albums, artists and external links', async ({ page }) => {
    const controller = await createRendererScenario(page, scenario().build(), '/record-labels/kosmische')
    await expect(page.getByRole('heading', { name: 'Kosmische' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'MusicBrainz' })).toHaveAttribute(
        'href',
        /musicbrainz.org\/label/,
    )
    await expect(page.getByRole('link', { name: 'Bandcamp' })).toHaveAttribute(
        'href',
        'https://kosmische.bandcamp.com',
    )
    await expect(page.getByRole('link', { name: 'Discogs' })).toHaveAttribute(
        'href',
        'http://www.discogs.com/label/1',
    )
    await expect
        .poll(async () => (await controller.lastCall('library:query-songs'))?.payload)
        .toMatchObject({ query: { filter: { recordLabelIds: ['kosmische'] } } })
    await page.getByRole('link', { name: 'Albums 1' }).click()
    await expect
        .poll(async () => (await controller.lastCall('library:query-albums'))?.payload)
        .toMatchObject({ query: { filter: { recordLabelIds: ['kosmische'] } } })
    await page.getByRole('link', { name: 'Artists 1' }).click()
    await expect(
        page.getByRole('region', { name: 'Artists' }).getByRole('link', { name: 'Aurora Fields' }),
    ).toBeVisible()
})

test('record label detail has retry and missing states', async ({ page }) => {
    const controller = await createRendererScenario(
        page,
        scenario().handler('library:get-record-label-detail', { kind: 'reject', message: 'Offline' }).build(),
        '/record-labels/kosmische',
    )
    await expect(page.getByText('Could not load this record label')).toBeVisible()
    await controller.setHandler('library:get-record-label-detail', { kind: 'resolve', value: null })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('This record label is no longer in your library')).toBeVisible()
})
