import { showMainWindow } from './app-window'

describe('showMainWindow', () => {
    const mainWindow = () => ({
        show: jest.fn(),
        showInactive: jest.fn(),
    })

    it('shows an E2E window without activating it in background mode', () => {
        const window = mainWindow()

        showMainWindow(window, true)

        expect(window.showInactive).toHaveBeenCalledTimes(1)
        expect(window.show).not.toHaveBeenCalled()
    })

    it('shows and activates a normal application window', () => {
        const window = mainWindow()

        showMainWindow(window, false)

        expect(window.show).toHaveBeenCalledTimes(1)
        expect(window.showInactive).not.toHaveBeenCalled()
    })
})
