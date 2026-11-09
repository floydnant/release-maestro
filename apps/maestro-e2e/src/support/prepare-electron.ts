import { execFileSync } from 'node:child_process'

export default function prepareElectron(): void {
    // Install or refresh the binary once, before parallel workers can launch Electron.
    execFileSync(process.execPath, [require.resolve('electron/install.js')], { stdio: 'inherit' })
}
