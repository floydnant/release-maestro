import { Route } from '@angular/router'
import { webEnv } from '../environments/environment'
import { commonRoutes } from './app.routes.common'
import { PageNotFoundComponent } from './pages/page-not-found/page-not-found.component'

/**
 * The development route table. `app.routes.prod.ts` replaces this file in a production
 * build; both compose `commonRoutes`, so only what is genuinely development-only lives
 * here — see `app.routes.common.ts`.
 */
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
    ...commonRoutes,
    ...developmentRoutes,
    {
        path: '**',
        component: PageNotFoundComponent,
    },
]
