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
        path: 'settings',
        component: SettingsComponent,
        children: [
            {
                path: 'apple-mail',
                loadComponent: () =>
                    import('./pages/settings/importers/apple-mail/apple-mail.component').then(
                        m => m.AppleMailImporterComponent,
                    ),
            },
        ],
    },
    {
        path: '**',
        component: PageNotFoundComponent,
    },
]
