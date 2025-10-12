import { app, autoUpdater, dialog, MessageBoxOptions } from 'electron'
import { platform, arch } from 'os'
import { updateServerUrl } from '../constants'
import App from '../app'

export default class UpdateEvents {
    // initialize auto update service - most be invoked only in production
    static initAutoUpdateService() {
        const platform_arch = platform() === 'win32' ? platform() : platform() + '_' + arch()
        const version = app.getVersion()
        const feed: Electron.FeedURLOptions = { url: `${updateServerUrl}/update/${platform_arch}/${version}` }

        if (!App.isDevelopmentMode()) {
            console.log('Initializing auto update service...\n')

            autoUpdater.setFeedURL(feed)
            UpdateEvents.checkForUpdates()
        }
    }

    // check for updates - most be invoked after initAutoUpdateService() and only in production
    static checkForUpdates() {
        if (!App.isDevelopmentMode() && autoUpdater.getFeedURL() !== '') {
            autoUpdater.checkForUpdates()
        }
    }
}

autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName, releaseDate) => {
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

autoUpdater.on('error', message => {
    console.error('There was a problem updating the application')
    console.error(message, '\n')
})
