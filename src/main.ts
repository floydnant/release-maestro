import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http'
import { enableProdMode, importProvidersFrom } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import { provideRouter } from '@angular/router'
import { TranslateLoader, TranslateModule } from '@ngx-translate/core'
import { TranslateHttpLoader } from '@ngx-translate/http-loader'
import { AppComponent } from './app/app.component'
import { CoreModule } from './app/core/core.module'
import { FeedComponent } from './app/pages/feed/feed.component'
import { HomeComponent } from './app/pages/home/home.component'
import { ImportComponent } from './app/pages/import/import.component'
import { PageNotFoundComponent } from './app/pages/page-not-found/page-not-found.component'
import { SharedModule } from './app/shared/shared.module'
import { webEnv } from './environments/environment'

// AoT requires an exported function for factories
const httpLoaderFactory = (http: HttpClient): TranslateHttpLoader =>
    new TranslateHttpLoader(http, './assets/i18n/', '.json')

if (webEnv.production) {
    enableProdMode()
}

bootstrapApplication(AppComponent, {
    providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideRouter([
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
                path: 'import',
                component: ImportComponent,
                children: [
                    {
                        path: 'apple-mail',
                        loadComponent: () =>
                            import('./app/pages/import/importers/apple-mail/apple-mail.component').then(
                                m => m.AppleMailImporterComponent,
                            ),
                    },
                ],
            },
            {
                path: '**',
                component: PageNotFoundComponent,
            },
        ]),
        importProvidersFrom(
            CoreModule,
            SharedModule,
            TranslateModule.forRoot({
                loader: {
                    provide: TranslateLoader,
                    useFactory: httpLoaderFactory,
                    deps: [HttpClient],
                },
            }),
        ),
    ],
}).catch(err => console.error(err))
