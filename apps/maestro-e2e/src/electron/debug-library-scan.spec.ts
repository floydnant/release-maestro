import { expect, test, TestInfo } from '@playwright/test'
import { _electron as electron, ElectronApplication, Page } from 'playwright'
import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const workspaceRoot = join(__dirname, '../../../..')
const electronMainPath = join(workspaceRoot, 'dist/apps/maestro-electron/main.js')
const sourceFixturePath = join(workspaceRoot, 'fixtures/06-karasu-ktmp3.mp3')

const cleanEnv = (): Record<string, string> => {
    const env = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] == 'string'),
    )
    delete env.ELECTRON_RUN_AS_NODE
    return env
}

const launchReleaseMaestro = async (appDataDir: string): Promise<ElectronApplication> =>
    electron.launch({
        args: [electronMainPath],
        cwd: workspaceRoot,
        env: {
            ...cleanEnv(),
            ELECTRON_IS_DEV: '1',
            RELEASE_MAESTRO_APP_DATA_DIR: appDataDir,
        },
    })

const openDebugConsole = async (page: Page): Promise<void> => {
    await expect(page).toHaveTitle(/Release Maestro/)
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('link', { name: 'Debug' }).click()
    await expect(page.getByRole('heading', { name: 'Debug Console' })).toBeVisible()
    await expect(page.getByText(/Metadata worker Ready/)).toBeVisible()
}

const copyFixtureLibrary = async (testInfo: TestInfo) => {
    const libraryDir = testInfo.outputPath('library')
    const fixturePath = join(libraryDir, 'karasu.mp3')

    await mkdir(libraryDir, { recursive: true })
    await cp(sourceFixturePath, fixturePath)

    return { fixturePath, libraryDir }
}

const readFile = async (page: Page, fixturePath: string) => {
    await page.getByLabel('Read file path').fill(fixturePath)
    await page.getByRole('button', { name: 'Read File' }).click()

    const result = page.getByLabel('Read result')
    await expect(result).toContainText('"path"')
    await expect(result).toContainText('karasu.mp3')
    return result
}

const metric = (page: Page, name: string) => page.getByLabel(name, { exact: true })

let electronApp: ElectronApplication | undefined
let page: Page

test.beforeEach(async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })

    electronApp = await launchReleaseMaestro(appDataDir)
    page = await electronApp.firstWindow()
    await openDebugConsole(page)
})

test.afterEach(async () => {
    await electronApp?.close()
    electronApp = undefined
})

test('reports metadata worker health in the full Electron app', async () => {
    await expect(page.getByText(/Metadata worker Ready/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Metadata engine' })).toBeVisible()
})

test('reads tags from a copied fixture file', async ({}, testInfo) => {
    const { fixturePath } = await copyFixtureLibrary(testInfo)

    const result = await readFile(page, fixturePath)

    await expect(result).toContainText('"fileName"')
    await expect(result).toContainText('"fileInfo"')
})

test('writes tags to a copied fixture file and reads the update back', async ({}, testInfo) => {
    const { fixturePath } = await copyFixtureLibrary(testInfo)
    const title = `E2E updated title ${testInfo.retry}`

    await readFile(page, fixturePath)
    await page.getByRole('button', { name: 'Copy To Write' }).click()
    await page.getByLabel('Write tag payload').fill(JSON.stringify({ title, musicalKey: 'Am' }, null, 2))
    await page.getByRole('button', { name: 'Write Tags' }).click()

    await expect(page.getByLabel('Write result')).toContainText(title)
    await expect(page.getByLabel('Write result')).toContainText('"musicalKey": "Am"')

    const readBackResult = await readFile(page, fixturePath)
    await expect(readBackResult).toContainText(title)
    await expect(readBackResult).toContainText('"musicalKey": "Am"')
})

test('scans a temp library and persists reconciliation state across scans', async ({}, testInfo) => {
    const { libraryDir } = await copyFixtureLibrary(testInfo)

    await page.getByLabel('Library scan paths').fill(libraryDir)
    await page.getByRole('button', { name: 'Start Scan' }).click()

    await expect(metric(page, 'Scan status')).toHaveText('idle')
    await expect(metric(page, 'New songs')).toHaveText('1')
    await expect(metric(page, 'Changed songs')).toHaveText('0')
    await expect(metric(page, 'Unchanged songs')).toHaveText('0')
    await expect(metric(page, 'Missing songs')).toHaveText('0')
    await expect(metric(page, 'Summary errors')).toHaveText('0')
    await expect(metric(page, 'Scanned items')).toHaveText('1')
    await expect(metric(page, 'Raw scan summary')).toContainText('"new": 1')
    await expect(metric(page, 'Latest ingested metadata')).toContainText('karasu.mp3')

    await page.getByRole('button', { name: 'Start Scan' }).click()

    await expect(metric(page, 'Scan status')).toHaveText('idle')
    await expect(metric(page, 'New songs')).toHaveText('0')
    await expect(metric(page, 'Changed songs')).toHaveText('0')
    await expect(metric(page, 'Unchanged songs')).toHaveText('1')
    await expect(metric(page, 'Missing songs')).toHaveText('0')
    await expect(metric(page, 'Summary errors')).toHaveText('0')
    await expect(metric(page, 'Raw scan summary')).toContainText('"unchanged": 1')
})
