import SquirrelEvents from './app/events/squirrel.events'
import ElectronEvents from './app/events/electron.events'
import UpdateEvents from './app/events/update.events'
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

// initialize auto updater service
if (!App.isDevelopmentMode()) {
    UpdateEvents.initAutoUpdateService()
}
