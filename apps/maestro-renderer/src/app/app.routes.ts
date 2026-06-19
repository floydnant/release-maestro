import { Route } from '@angular/router'
import { webEnv } from '../environments/environment'
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
