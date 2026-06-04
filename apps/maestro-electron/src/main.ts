import 'dotenv/config'
import SquirrelEvents from './app/events/squirrel.events'
import ElectronEvents from './app/events/electron.events'
import UpdateEvents from './app/events/update.events'
import AppEvents from './app/events/app.events'
import { app, BrowserWindow } from 'electron'
import App from './app/app'

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

// Add cleanup on app exit
app.on('window-all-closed', async () => {
    // Cleanup DI container
    try {
        const { diContainer } = await import('./app/di')
        await diContainer.destroyAll()
    } catch (error) {
        console.error('Error during cleanup:', error)
    }

    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
