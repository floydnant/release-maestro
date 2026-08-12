import { Route } from '@angular/router'
import { FeedComponent } from './pages/feed/feed.component'
import { HomeComponent } from './pages/home/home.component'
import { PageNotFoundComponent } from './pages/page-not-found/page-not-found.component'
import { SettingsComponent } from './pages/settings/settings.component'

export const appRoutes: Route[] = [
    {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full',
    },
    {
        path: 'home',
        component: HomeComponent,
    },
    {
        path: 'feed',
        component: FeedComponent,
    },
    {
        path: 'albums',
        loadComponent: () => import('./pages/albums/albums.component').then(m => m.AlbumsComponent),
    },
    {
        path: 'albums/:albumId',
        loadComponent: () =>
            import('./pages/album-detail/album-detail.component').then(m => m.AlbumDetailComponent),
    },
    {
        path: 'settings',
        component: SettingsComponent,
        children: [
            {
                path: 'apple-mail',
                loadComponent: () =>
                    import('./pages/settings/importers/apple-mail/apple-mail.component').then(
                        module => module.AppleMailImporterComponent,
                    ),
            },
        ],
    },
    {
        path: '**',
        component: PageNotFoundComponent,
    },
]
