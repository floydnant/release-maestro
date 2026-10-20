import { inject } from '@angular/core'
import { CanActivateFn, PRIMARY_OUTLET, Router, UrlSegment, UrlSegmentGroup, UrlTree } from '@angular/router'
import { ElectronService } from '../services/electron/electron.service'

/**
 * Routes users into the full-page library onboarding (`/import`) until they have
 * either configured library folders or explicitly skipped onboarding (in which
 * case a persistent sidebar CTA keeps nudging instead of gating).
 */
export const libraryOnboardingGuard: CanActivateFn = async (_route, state) => {
    const electronService = inject(ElectronService)
    const router = inject(Router)

    // Browser dev mode has no settings IPC; never gate there.
    if (!electronService.isElectron) return true

    const settings = await electronService.ipcRenderer.invoke('get-settings')
    const hasLibrary = (settings.library?.folders?.length ?? 0) > 0
    if (hasLibrary || settings.library?.onboardingSkipped) return true

    // Preserve root dialogs and URL state while switching the page to onboarding.
    const requested = router.parseUrl(state.url)
    return new UrlTree(
        new UrlSegmentGroup([], {
            ...requested.root.children,
            [PRIMARY_OUTLET]: new UrlSegmentGroup([new UrlSegment('import', {})], {}),
        }),
        requested.queryParams,
        requested.fragment,
    )
}
