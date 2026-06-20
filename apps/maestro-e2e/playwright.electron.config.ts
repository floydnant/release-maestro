import { defineConfig } from '@playwright/test'
import { nxE2EPreset } from '@nx/playwright/preset'
import { workspaceRoot } from '@nx/devkit'

export default defineConfig({
    ...nxE2EPreset(__filename, { testDir: './src/electron' }),
    reporter: [['html', { open: 'never' }], ['list']],
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    timeout: 120_000,
    expect: {
        timeout: 20_000,
    },
    use: {
        trace: 'on-first-retry',
    },
    webServer: {
        command: 'make serve-renderer',
        url: 'http://localhost:4200',
        reuseExistingServer: !process.env.CI,
        cwd: workspaceRoot,
        timeout: 120_000,
    },
})
