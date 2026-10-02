import 'dotenv/config'
import SquirrelEvents from './app/events/squirrel.events'
import ElectronEvents from './app/events/electron.events'
import UpdateEvents from './app/events/update.events'
import AppEvents from './app/events/app.events'
import { app, BrowserWindow } from 'electron'
import App from './app/app'
import { developmentAppName } from './app/constants'
import { cleanupApplication } from './app/app-shutdown'

if (developmentAppName) app.setName(developmentAppName)

// handle setup events as quickly as possible
if (SquirrelEvents.handleEvents()) {
    // squirrel event handled (except first run event) and app will exit in 1000ms, so don't do anything else
    app.quit()
}

// bootstrap app
App.main(app, BrowserWindow)

ElectronEvents.bootstrapElectronEvents()
AppEvents.bootstrapAppEvents()

// initialize auto updater service
if (!App.isDevelopmentMode()) {
    UpdateEvents.initAutoUpdateService()
}

// Main-process services outlive windows. Electron does not await event handlers, so hold the first
// quit until the running import drains before destroyAll closes its database and other dependencies.
let quitCleanup: Promise<void> | null = null
let cleanupComplete = false
app.on('before-quit', event => {
    if (cleanupComplete) return
    event.preventDefault()

    quitCleanup ??= cleanupApplication().finally(() => {
        cleanupComplete = true
        app.quit()
    })
})
