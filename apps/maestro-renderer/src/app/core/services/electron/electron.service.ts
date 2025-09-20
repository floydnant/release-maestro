import { Injectable } from '@angular/core'
import { ipcRenderer, webFrame } from 'electron'
import * as childProcess from 'child_process'
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'

@Injectable({
    providedIn: 'root',
})
export class ElectronService {
    ipcRenderer!: typeof ipcRenderer
    webFrame!: typeof webFrame
    childProcess!: typeof childProcess
    fs!: typeof fs
    fsPromises!: typeof fsPromises

    constructor() {
        // Conditional imports
        if (this.isElectron) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
            this.ipcRenderer = (window as any).require('electron').ipcRenderer
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
            this.webFrame = (window as any).require('electron').webFrame

            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
            this.fs = (window as any).require('fs')
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
            this.fsPromises = (window as any).require('fs/promises')

            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
            this.childProcess = (window as any).require('child_process')
            this.childProcess.exec('node -v', (error, stdout, stderr) => {
                if (error) {
                    console.error(`error: ${error.message}`)
                    return
                }
                if (stderr) {
                    console.error(`stderr: ${stderr}`)
                    return
                }
                console.log(`stdout:\n${stdout}`)
            })

            // Notes :
            // * A NodeJS's dependency imported with 'window.require' MUST BE present in `dependencies` of both `app/package.json`
            // and `package.json (root folder)` in order to make it work here in Electron's Renderer process (src folder)
            // because it will loaded at runtime by Electron.
            // * A NodeJS's dependency imported with TS module import (ex: import { Dropbox } from 'dropbox') CAN only be present
            // in `dependencies` of `package.json (root folder)` because it is loaded during build phase and does not need to be
            // in the final bundle. Reminder : only if not used in Electron's Main process (app folder)

            // If you want to use a NodeJS 3rd party deps in Renderer process,
            // ipcRenderer.invoke can serve many common use cases.
            // https://www.electronjs.org/docs/latest/api/ipc-renderer#ipcrendererinvokechannel-args
        }
    }

    get isElectron(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        return !!(window && window.process && window.process.type)
    }

    async openUrl(url: string) {
        await this.ipcRenderer.invoke('open-url', url)
    }
}
