import { Route } from '@angular/router'
import { commonRoutes } from './app.routes.common'
import { PageNotFoundComponent } from './pages/page-not-found/page-not-found.component'

/**
 * The production route table, swapped in for `app.routes.ts` by the `fileReplacements` in
 * `project.json`.
 *
 * Its only job is to leave the token specimen page out, so that neither it nor the
 * token-documentation machinery it pulls in reaches the shipped bundle. A check in
 * `tools/design-tokens.cjs` enforces that by scanning this file, so nothing here may name
 * that route even in a comment.
 *
 * Everything the app actually does lives in `commonRoutes` — this file must not restate
 * routes, which is how it previously came to be missing `/tracks` and `/import`.
 */
export const appRoutes: Route[] = [
    ...commonRoutes,
    {
        path: '**',
        component: PageNotFoundComponent,
    },
]
