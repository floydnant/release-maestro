import { inject } from '@angular/core'
import { CanActivateFn, Router } from '@angular/router'
import { ElectronService } from '../services/electron/electron.service'

/**
 * Routes users into the full-page library onboarding (`/import`) until they have
 * either configured library folders or explicitly skipped onboarding (in which
 * case a persistent sidebar CTA keeps nudging instead of gating).
 */
export const libraryOnboardingGuard: CanActivateFn = async () => {
    const electronService = inject(ElectronService)
    const router = inject(Router)

    // Browser dev mode has no settings IPC; never gate there.
    if (!electronService.isElectron) return true

    const settings = await electronService.ipcRenderer.invoke('get-settings')
    const hasLibrary = (settings.libraryFolders?.length ?? 0) > 0
    if (hasLibrary || settings.libraryOnboardingSkipped) return true

    return router.createUrlTree(['/import'])
}
