import { expect, test } from '@playwright/test'
import { copyFile, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ElectronApplication, Page } from 'playwright'
import { z } from 'zod'
import { buildTaggedLibrary, cleanupTaggedLibraries } from '../fixtures/tagged-library.fixture'
import { launchReleaseMaestro } from './launch-release-maestro'

let app: ElectronApplication | undefined

test.afterEach(async ({}, testInfo) => {
    try {
        await app?.close()
    } finally {
        app = undefined
        await cleanupTaggedLibraries(testInfo)
    }
})

const songs = async (page: Page) => {
    const result: unknown = await page.evaluate(async () => {
        const { ipcRenderer }: typeof import('electron') = require('electron')
        return ipcRenderer.invoke('library:query-songs', {
            query: { filter: {}, search: '', sort: { field: 'title', direction: 'asc' } },
            window: { offset: 0, limit: 100 },
        })
    })
    return z
        .object({
            rows: z.array(
                z.object({
                    id: z.string(),
                    path: z.string(),
                    title: z.string(),
                    present: z.boolean(),
                    dateAdded: z.number().nullable(),
                }),
            ),
        })
        .parse(result).rows
}

const scanStatus = async (page: Page) => {
    const result: unknown = await page.evaluate(async () => {
        const { ipcRenderer }: typeof import('electron') = require('electron')
        return ipcRenderer.invoke('library:get-scan-status')
    })
    return z
        .object({
            status: z.object({
                scanId: z.number(),
                phase: z.string(),
                terminal: z
                    .object({
                        new: z.number(),
                        changed: z.number(),
                        missing: z.number(),
                        discoveryFailureCount: z.number(),
                        readFailureCount: z.number(),
                    })
                    .nullable(),
            }),
        })
        .parse(result).status
}

const rescan = async (page: Page, button = 'Rescan now') => {
    const before = await scanStatus(page)
    await page.getByRole('button', { name: button, exact: true }).click()
    await expect
        .poll(async () => {
            const status = await scanStatus(page)
            return status.scanId > before.scanId && status.phase === 'completed'
        })
        .toBe(true)
    const status = await scanStatus(page)
    expect(status.terminal).toMatchObject({ discoveryFailureCount: 0, readFailureCount: 0 })
    return status.terminal
}

const chooseFolder = async (electron: ElectronApplication, directory: string) => {
    await electron.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath], bookmarks: [] })
    }, directory)
}

test('renames, folder moves and missing-first relocation preserve track IDs and Added dates', async ({}, testInfo) => {
    const library = await buildTaggedLibrary(testInfo)
    const relocated = await buildTaggedLibrary(testInfo, [])
    const appData = testInfo.outputPath('app-data')
    await mkdir(appData, { recursive: true })
    app = await launchReleaseMaestro(appData, testInfo)
    let page = await app.firstWindow()
    await chooseFolder(app, library)
    await page.getByRole('button', { name: 'Add folders', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your library is ready' })).toBeVisible()
    await page.getByRole('button', { name: 'Take me to my library' }).click()
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('link', { name: 'Library', exact: true }).click()
    const original = await songs(page)
    const identity = (rows: typeof original) =>
        rows.map(({ id, title, dateAdded }) => ({ id, title, dateAdded }))
    const identities = identity(original)
    expect(original).toHaveLength(6)
    const first = original[0]
    if (!first) throw new Error('Expected an imported track')

    const renamed = join(library, 'renamed.mp3')
    await rename(first.path, renamed)
    expect(await rescan(page)).toMatchObject({ new: 0, changed: 1, missing: 0 })
    expect(identity(await songs(page))).toEqual(identities)
    expect((await songs(page)).find(song => song.id === first.id)?.path).toBe(renamed)

    const nested = join(library, 'nested')
    await mkdir(nested)
    for (const name of await readdir(library)) {
        if (name.endsWith('.mp3')) await rename(join(library, name), join(nested, name))
    }
    expect(await rescan(page)).toMatchObject({ new: 0, changed: 6, missing: 0 })
    expect(identity(await songs(page))).toEqual(identities)

    // Simulate a removed drive, then restore only part of its library at another location.
    const storage = join(relocated, 'offline')
    await rename(nested, storage)
    expect(await rescan(page)).toMatchObject({ missing: 6 })
    expect((await songs(page)).every(song => !song.present)).toBe(true)
    const returned = (await readdir(storage)).slice(0, 3)
    const newFolder = join(relocated, 'available')
    await mkdir(newFolder)
    for (const name of returned) await rename(join(storage, name), join(newFolder, name))
    await chooseFolder(app, newFolder)
    await page.getByRole('button', { name: 'Add folders…' }).click()
    expect(await rescan(page, 'Save and rescan')).toMatchObject({ new: 0, changed: 3, missing: 0 })
    expect(identity(await songs(page))).toEqual(identities)
    expect((await songs(page)).filter(song => song.present)).toHaveLength(3)

    // Restart and repeat without changes. Identity and availability must remain stable.
    await app.close()
    app = await launchReleaseMaestro(appData, testInfo)
    page = await app.firstWindow()
    await expect.poll(async () => (await scanStatus(page)).phase).toBe('completed')
    expect(identity(await songs(page))).toEqual(identities)
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('link', { name: 'Library', exact: true }).click()
    expect(await rescan(page)).toMatchObject({ new: 0, changed: 0, missing: 0 })

    // Return all files to their original paths, including the renamed one.
    for (const song of original) {
        const name = song.id === first.id ? basename(renamed) : basename(song.path)
        const from = returned.includes(name) ? newFolder : storage
        await rename(join(from, name), song.path)
    }
    expect(await rescan(page)).toMatchObject({ new: 0, missing: 0 })
    expect(await songs(page)).toEqual(original)
    await page.getByRole('link', { name: 'Tracks', exact: true }).click()
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '6 tracks' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Missing — show only missing tracks' })).toHaveCount(0)

    // A genuine copy is a second track. Losing the original later must not merge their IDs.
    await copyFile(first.path, join(library, 'copy.mp3'))
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('link', { name: 'Library', exact: true }).click()
    await rescan(page)
    const copies = await songs(page)
    expect(copies).toHaveLength(7)
    await rm(first.path)
    await rescan(page)
    const afterRemoval = await songs(page)
    expect(afterRemoval.map(song => song.id).sort()).toEqual(copies.map(song => song.id).sort())
    expect(afterRemoval.find(song => song.id === first.id)?.present).toBe(false)
})
