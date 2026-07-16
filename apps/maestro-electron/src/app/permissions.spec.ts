import { configurePermissionPolicy } from './permissions'

describe('configurePermissionPolicy', () => {
    it('denies media capture requests so playback does not prompt for microphone access', () => {
        const setPermissionRequestHandler = jest.fn()

        configurePermissionPolicy({ setPermissionRequestHandler })

        const handler = setPermissionRequestHandler.mock.calls[0][0]
        const respond = jest.fn()

        handler(undefined, 'media', respond, { mediaTypes: ['audio'] })

        expect(respond).toHaveBeenCalledWith(false)
    })

    it('does not grant unrelated permission requests', () => {
        const setPermissionRequestHandler = jest.fn()

        configurePermissionPolicy({ setPermissionRequestHandler })

        const handler = setPermissionRequestHandler.mock.calls[0][0]
        const respond = jest.fn()

        handler(undefined, 'notifications', respond, {})

        expect(respond).toHaveBeenCalledWith(false)
    })
})
