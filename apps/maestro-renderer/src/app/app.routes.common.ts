import { Route } from '@angular/router'
import { libraryOnboardingGuard } from './core/guards/library-onboarding.guard'
import { FeedComponent } from './pages/feed/feed.component'
import { HomeComponent } from './pages/home/home.component'
import { SettingsComponent } from './pages/settings/settings.component'

/**
 * Every route the app ships, in both configurations.
 *
 * `app.routes.prod.ts` replaces `app.routes.ts` in a production build (see the
 * `fileReplacements` in `project.json`), which exists to keep the design-system specimen
 * and its dependencies out of the shipped bundle. Both files compose this list rather
 * than restating it, because a hand-maintained copy of the route table is a copy that
 * goes stale silently: the production one had already lost `/tracks` and `/import`, so a
 * packaged build answered the sidebar's own Tracks link with the not-found page.
 *
 * Add a route here. Add it to `app.routes.ts` alone only when it must not ship at all.
 */
export const commonRoutes: Route[] = [
    {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full',
    },
    {
        path: 'home',
        component: HomeComponent,
        canActivate: [libraryOnboardingGuard],
    },
    {
        path: 'feed',
        component: FeedComponent,
        canActivate: [libraryOnboardingGuard],
    },
    {
        path: 'tracks',
        loadComponent: () => import('./pages/tracks/tracks.component').then(m => m.TracksComponent),
        canActivate: [libraryOnboardingGuard],
    },
    {
        path: 'albums',
        loadComponent: () => import('./pages/albums/albums.component').then(m => m.AlbumsComponent),
        canActivate: [libraryOnboardingGuard],
    },
    {
        // `albumId` rather than `id`, because the component reads it by name and album is
        // the word in code and in copy alike — see the glossary.
        path: 'albums/:albumId',
        loadComponent: () =>
            import('./pages/album-detail/album-detail.component').then(m => m.AlbumDetailComponent),
        canActivate: [libraryOnboardingGuard],
    },
    {
        // No onboarding guard: this route *is* where the guard sends people.
        path: 'import',
        loadComponent: () =>
            import('./pages/library-import/library-import.component').then(m => m.LibraryImportComponent),
    },
    {
        path: 'settings',
        component: SettingsComponent,
        children: [
            {
                path: 'library',
                loadComponent: () =>
                    import('./pages/settings/library/library-settings.component').then(
                        m => m.LibrarySettingsComponent,
                    ),
            },
            {
                path: 'debug',
                loadComponent: () =>
                    import('./pages/settings/debug/debug.component').then(m => m.DebugComponent),
            },
            {
                path: 'apple-mail',
                loadComponent: () =>
                    import('./pages/settings/importers/apple-mail/apple-mail.component').then(
                        m => m.AppleMailImporterComponent,
                    ),
            },
        ],
    },
]
