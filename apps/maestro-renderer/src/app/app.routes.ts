import { Route } from '@angular/router'
import { webEnv } from '../environments/environment'
import { libraryOnboardingGuard } from './core/guards/library-onboarding.guard'
import { FeedComponent } from './pages/feed/feed.component'
import { HomeComponent } from './pages/home/home.component'
import { PageNotFoundComponent } from './pages/page-not-found/page-not-found.component'
import { SettingsComponent } from './pages/settings/settings.component'

const developmentRoutes: Route[] = webEnv.production
    ? []
    : [
          {
              path: 'design-system',
              loadComponent: () =>
                  import('./pages/design-system/design-system.component').then(
                      module => module.DesignSystemComponent,
                  ),
          },
      ]

export const appRoutes: Route[] = [
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
        path: 'albums/:albumId',
        loadComponent: () =>
            import('./pages/album-detail/album-detail.component').then(m => m.AlbumDetailComponent),
        canActivate: [libraryOnboardingGuard],
    },
    {
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
    ...developmentRoutes,
    {
        path: '**',
        component: PageNotFoundComponent,
    },
]
