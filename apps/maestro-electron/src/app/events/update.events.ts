// TODO: Install electron-updater: npm install electron-updater
// import { autoUpdater } from 'electron-updater'
// import { dialog, MessageBoxOptions } from 'electron'
import App from '../app'

export default class UpdateEvents {
    // initialize auto update service - must be invoked only in production
    static initAutoUpdateService() {
        if (!App.isDevelopmentMode()) {
            console.log('Initializing auto update service...\n')

            // TODO: Uncomment when electron-updater is installed
            // Configure update server (GitHub Releases by default)
            // autoUpdater.setFeedURL('https://your-update-server.com')

            // UpdateEvents.checkForUpdates()
        }
    }

    // check for updates - must be invoked after initAutoUpdateService() and only in production
    static checkForUpdates() {
        if (!App.isDevelopmentMode()) {
            // TODO: Uncomment when electron-updater is installed
            // autoUpdater.checkForUpdatesAndNotify()
            console.log('Auto-updater not configured yet')
        }
    }
}

// TODO: Uncomment when electron-updater is installed
/*
autoUpdater.on('update-downloaded', (_event, releaseNotes, releaseName, _releaseDate) => {
    const dialogOpts: MessageBoxOptions = {
        type: 'info' as const,
        buttons: ["Let's do it!", 'Ask me Later'],
        title: 'App Update',
        message: process.platform === 'win32' ? releaseNotes : releaseName,
        detail: 'Release Maestro just got better! Restart the app to apply the update.',
    }

    dialog.showMessageBox(dialogOpts).then(returnValue => {
        if (returnValue.response === 0) autoUpdater.quitAndInstall()
    })
})

autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...\n')
})

autoUpdater.on('update-available', () => {
    console.log('New update available!\n')
})

autoUpdater.on('update-not-available', () => {
    console.log('Up to date!\n')
})

autoUpdater.on('before-quit-for-update', () => {
    console.log('Application update is about to begin...\n')
})

autoUpdater.on('error', (error: Error) => {
    console.error('There was a problem updating the application')
    console.error(error.message, '\n')
})
*/
