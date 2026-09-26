import { workspaceRoot } from '@nx/devkit'
import { nxE2EPreset } from '@nx/playwright/preset'
import { defineConfig } from '@playwright/test'
import { environmentPort } from './src/support/environment-port'

const electronE2EPort = environmentPort('RELEASE_MAESTRO_RENDERER_PORT', 4200)
const electronE2EBaseURL = `http://localhost:${electronE2EPort}`

export default defineConfig({
    ...nxE2EPreset(__filename, { testDir: './src/electron' }),
    outputDir: `${workspaceRoot}/dist/.playwright/maestro-e2e-electron/test-output`,
    reporter: [
        ['html', { open: 'never', outputFolder: `${workspaceRoot}/playwright-report/electron` }],
        ['list'],
    ],
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : 3,
    timeout: 120_000,
    expect: {
        timeout: 20_000,
    },
    webServer: {
        command: `pnpm exec nx serve maestro-renderer --host localhost --port ${electronE2EPort}`,
        url: electronE2EBaseURL,
        reuseExistingServer: !process.env.CI,
        cwd: workspaceRoot,
        timeout: 120_000,
    },
})
