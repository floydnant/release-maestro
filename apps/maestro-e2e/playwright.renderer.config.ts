import { workspaceRoot } from '@nx/devkit'
import { nxE2EPreset } from '@nx/playwright/preset'
import { defineConfig, devices } from '@playwright/test'

const rendererE2EPort = 4201
const baseURL = process.env['BASE_URL'] || `http://localhost:${rendererE2EPort}`

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    ...nxE2EPreset(__filename, { testDir: './src/renderer' }),
    outputDir: `${workspaceRoot}/dist/.playwright/maestro-e2e-renderer/test-output`,
    testIgnore: 'electron/**',
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        baseURL,
        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'retain-on-failure-and-retries',
    },
    reporter: [
        ['html', { open: 'never', outputFolder: `${workspaceRoot}/playwright-report/renderer` }],
        ['list'],
    ],
    workers: process.env.CI ? 1 : 3,
    webServer: process.env['BASE_URL']
        ? undefined
        : {
              command: 'npx nx serve maestro-renderer -c e2e',
              url: baseURL,
              reuseExistingServer: !process.env.CI,
              cwd: workspaceRoot,
          },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
})
