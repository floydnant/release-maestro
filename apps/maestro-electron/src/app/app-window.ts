import type { BrowserWindow } from 'electron'

type ShowableWindow = Pick<BrowserWindow, 'show' | 'showInactive' | 'blur'>

/** Show E2E windows without activating them, while preserving normal application startup. */
export const showMainWindow = (
    mainWindow: ShowableWindow,
    background = process.env.RELEASE_MAESTRO_E2E_BACKGROUND === '1',
): void => {
    if (background) {
        mainWindow.showInactive()
        mainWindow.blur()
    } else mainWindow.show()
}
