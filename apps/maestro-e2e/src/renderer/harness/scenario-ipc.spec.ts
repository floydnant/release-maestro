// Covers the renderer scenario IPC harness contract: serialization, pending calls, and event listeners.
import { expect, test } from '@playwright/test'
import { createRendererScenario, rendererScenarios, scenarioBuilder } from '../scenario-harness'

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
