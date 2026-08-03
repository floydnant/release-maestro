// Covers the renderer scenario IPC harness contract: serialization, pending calls, and event listeners.
import { expect, test } from '@playwright/test'
import { createRendererScenario, rendererScenarios, respond, scenarioBuilder } from '../scenario-harness'

test.describe('renderer scenario IPC harness', () => {
    test('returns authoritative settings from set and patch handlers', async ({ page }) => {
        const scenario = scenarioBuilder()
            .settings({
                library: { folders: ['/music'] },
                emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Bandcamp' } },
            })
            .build()
        await createRendererScenario(page, scenario)

        const results = await page.evaluate(async () => {
            const electronModule = window.require?.('electron') as {
                ipcRenderer: {
                    invoke: (channel: string, payload: unknown) => Promise<unknown>
                }
            }
            const setResult = await electronModule.ipcRenderer.invoke('set-settings', {
                library: { folders: ['/archive'] },
                emailPluginConfig: { APPLE_MAIL: { mailboxName: 'New Releases' } },
            })
            const patchResult = await electronModule.ipcRenderer.invoke('patch-settings', {
                library: { folders: ['/archive', '/usb'] },
            })
            return { setResult, patchResult }
        })

        expect(results).toEqual({
            setResult: {
                library: { folders: ['/archive'] },
                emailPluginConfig: { APPLE_MAIL: { mailboxName: 'New Releases' } },
            },
            patchResult: {
                library: { folders: ['/archive', '/usb'] },
                emailPluginConfig: { APPLE_MAIL: { mailboxName: 'New Releases' } },
            },
        })
    })

    test('revives nested dates across the scenario IPC boundary', async ({ page }) => {
        const initialCapturedAt = new Date('2026-07-01T12:34:56.000Z')
        const updatedCapturedAt = new Date('2026-07-02T12:34:56.000Z')
        const pendingCapturedAt = new Date('2026-07-03T12:34:56.000Z')

        const scenario = scenarioBuilder()
            .handler('metadata:read', {
                kind: 'resolve',
                value: { nested: [{ capturedAt: initialCapturedAt }] },
            })
            .handler('metadata:write', { kind: 'pending' })
            .build()
        const controller = await createRendererScenario(page, scenario)

        const readCapturedAt = (channel: string) =>
            page.evaluate(async selectedChannel => {
                const electronModule = window.require?.('electron') as {
                    ipcRenderer: { invoke: (channel: string) => Promise<unknown> }
                }
                const value = (await electronModule.ipcRenderer.invoke(selectedChannel)) as {
                    nested: { capturedAt: Date }[]
                }
                const capturedAt = value.nested[0]?.capturedAt

                return {
                    isDate: capturedAt instanceof Date,
                    iso: capturedAt?.toISOString(),
                }
            }, channel)

        await expect(readCapturedAt('metadata:read')).resolves.toEqual({
            isDate: true,
            iso: initialCapturedAt.toISOString(),
        })

        await controller.setHandler('metadata:read', {
            kind: 'resolve',
            value: { nested: [{ capturedAt: updatedCapturedAt }] },
        })

        await expect(readCapturedAt('metadata:read')).resolves.toEqual({
            isDate: true,
            iso: updatedCapturedAt.toISOString(),
        })

        const pendingResult = readCapturedAt('metadata:write')
        await expect
            .poll(async () => controller.lastCall('metadata:write'))
            .toMatchObject({ channel: 'metadata:write' })
        await controller.resolvePending('metadata:write', {
            nested: [{ capturedAt: pendingCapturedAt }],
        })

        await expect(pendingResult).resolves.toEqual({
            isDate: true,
            iso: pendingCapturedAt.toISOString(),
        })
    })

    test('answers from a responder running in Node, with the request', async ({ page }) => {
        // The point of `respond()` over a canned value: the answer depends on what was
        // asked. Anything that only ever returns a fixture can prove a caller asked
        // correctly, never that it used what came back.
        const seen: unknown[] = []
        const scenario = scenarioBuilder()
            .handler(
                'metadata:read',
                respond(page, 'echo-path', (request: { path: string }) => {
                    seen.push(request)
                    return { title: `Read ${request.path}` }
                }),
            )
            .build()
        await createRendererScenario(page, scenario)

        const invoke = (path: string) =>
            page.evaluate(async requestedPath => {
                const electronModule = window.require?.('electron') as {
                    ipcRenderer: { invoke: (channel: string, payload: unknown) => Promise<unknown> }
                }
                return await electronModule.ipcRenderer.invoke('metadata:read', { path: requestedPath })
            }, path)

        await expect(invoke('/music/a.mp3')).resolves.toEqual({ title: 'Read /music/a.mp3' })
        await expect(invoke('/music/b.mp3')).resolves.toEqual({ title: 'Read /music/b.mp3' })

        // Ran in Node, so the test can see every request it answered.
        expect(seen).toEqual([{ path: '/music/a.mp3' }, { path: '/music/b.mp3' }])
    })

    test('keeps several responders apart by name', async ({ page }) => {
        // One `exposeFunction` binding is installed per page and dispatches by name, so
        // a second responder must not displace the first.
        const scenario = scenarioBuilder()
            .handler(
                'get-app-version',
                respond(page, 'version', () => '9.9.9-responder'),
            )
            .handler(
                'metadata:read',
                respond(page, 'metadata', () => ({ title: 'From metadata' })),
            )
            .build()
        await createRendererScenario(page, scenario)

        const results = await page.evaluate(async () => {
            const electronModule = window.require?.('electron') as {
                ipcRenderer: { invoke: (channel: string) => Promise<unknown> }
            }
            return {
                version: await electronModule.ipcRenderer.invoke('get-app-version'),
                metadata: await electronModule.ipcRenderer.invoke('metadata:read'),
            }
        })

        expect(results).toEqual({ version: '9.9.9-responder', metadata: { title: 'From metadata' } })
    })

    test('revives dates returned by a responder', async ({ page }) => {
        // A responder's answer crosses the same boundary as a canned value, so it has
        // to survive it the same way — otherwise `Date` arrives as a string and every
        // consumer of a timestamp quietly changes shape.
        const capturedAt = new Date('2026-07-04T12:34:56.000Z')
        const scenario = scenarioBuilder()
            .handler(
                'metadata:read',
                respond(page, 'dated', () => ({ nested: [{ capturedAt }] })),
            )
            .build()
        await createRendererScenario(page, scenario)

        const read = await page.evaluate(async () => {
            const electronModule = window.require?.('electron') as {
                ipcRenderer: { invoke: (channel: string) => Promise<unknown> }
            }
            const value = (await electronModule.ipcRenderer.invoke('metadata:read')) as {
                nested: { capturedAt: Date }[]
            }
            const value0 = value.nested[0]?.capturedAt
            return { isDate: value0 instanceof Date, iso: value0?.toISOString() }
        })

        expect(read).toEqual({ isDate: true, iso: capturedAt.toISOString() })
    })

    test('serves the window a song catalog was asked for', async ({ page }) => {
        const scenario = scenarioBuilder().songCatalog(page, 1_000).build()
        await createRendererScenario(page, scenario)

        const window40 = await page.evaluate(async () => {
            const electronModule = window.require?.('electron') as {
                ipcRenderer: { invoke: (channel: string, payload: unknown) => Promise<unknown> }
            }
            return (await electronModule.ipcRenderer.invoke('library:query-songs', {
                query: {},
                window: { offset: 40, limit: 3 },
            })) as { rows: { id: string; title: string }[]; offset: number; total: number }
        })

        expect(window40).toMatchObject({ offset: 40, total: 1_000 })
        expect(window40.rows.map(row => row.title)).toEqual(['Row 40', 'Row 41', 'Row 42'])
        // Built from `createSongRow`, so a row is a real `SongRow` carrying the
        // fixture's defaults — including an artist credit, which the hand-written
        // literal this replaced left empty because nothing type-checked it.
        expect(window40.rows[0]).toMatchObject({
            id: 'song-40',
            present: true,
            artistCredit: [{ artistId: 'artist-1', creditedAs: 'Aurora Fields', joinPhrase: '' }],
        })
    })

    test('clamps a window that runs past the end of the catalog', async ({ page }) => {
        const scenario = scenarioBuilder().songCatalog(page, 5).build()
        await createRendererScenario(page, scenario)

        const overrun = await page.evaluate(async () => {
            const electronModule = window.require?.('electron') as {
                ipcRenderer: { invoke: (channel: string, payload: unknown) => Promise<unknown> }
            }
            return (await electronModule.ipcRenderer.invoke('library:query-songs', {
                query: {},
                window: { offset: 3, limit: 50 },
            })) as { rows: unknown[]; offset: number; total: number }
        })

        // A viewport asking past the end is routine, not an error — the read side
        // behaves the same way.
        expect(overrun).toMatchObject({ offset: 3, total: 5 })
        expect(overrun.rows).toHaveLength(2)
    })

    test('supports one-shot renderer event listeners', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await page.evaluate(() => {
            const electronModule = window.require?.('electron') as {
                ipcRenderer: {
                    once: (channel: string, listener: () => void) => void
                }
            }
            let listenerCallCount = 0
            electronModule.ipcRenderer.once('email-import-progress', () => {
                listenerCallCount += 1
            })
            ;(
                window as unknown as { __scenarioOnceListenerCallCount: () => number }
            ).__scenarioOnceListenerCallCount = () => listenerCallCount
        })

        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 1,
            total: 2,
            message: 'First event',
        })
        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 2,
            total: 2,
            message: 'Second event',
        })

        await expect
            .poll(() =>
                page.evaluate(() =>
                    (
                        window as unknown as { __scenarioOnceListenerCallCount: () => number }
                    ).__scenarioOnceListenerCallCount(),
                ),
            )
            .toBe(1)
    })
})
