import { workspaceRoot } from '@nx/devkit'
import { nxE2EPreset } from '@nx/playwright/preset'
import { defineConfig } from '@playwright/test'

process.env['MAESTRO_E2E_PACKAGED'] = '1'

export default defineConfig({
    ...nxE2EPreset(__filename, { testDir: './src/electron' }),
    testIgnore: 'debug-library-scan.spec.ts',
    reporter: [
        ['html', { open: 'never', outputFolder: `${workspaceRoot}/playwright-report/production` }],
        ['list'],
    ],
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : 3,
    timeout: 120_000,
    expect: {
        timeout: 20_000,
    },
    outputDir: `${workspaceRoot}/dist/.playwright/maestro-e2e-production/test-output`,
})
