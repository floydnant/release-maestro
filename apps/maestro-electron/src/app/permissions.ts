import type { Session } from 'electron'

type PermissionSession = Pick<Session, 'setPermissionRequestHandler'>

/**
 * Release Maestro only plays audio; it never captures from user devices.
 * Deny permission requests explicitly so Chromium does not ask macOS for
 * microphone access while initializing playback-only Web Audio.
 */
export function configurePermissionPolicy(session: PermissionSession): void {
    session.setPermissionRequestHandler((_webContents, _permission, respond) => {
        respond(false)
    })
}
