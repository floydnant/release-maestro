import { workspaceRoot } from '@nx/devkit'
import { nxE2EPreset } from '@nx/playwright/preset'
import { defineConfig } from '@playwright/test'

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
        trace: 'retain-on-failure-and-retries',
    },
    webServer: {
        command: 'npx nx serve maestro-renderer --port 4200',
        url: 'http://localhost:4200',
        reuseExistingServer: !process.env.CI,
        cwd: workspaceRoot,
        timeout: 120_000,
    },
})
