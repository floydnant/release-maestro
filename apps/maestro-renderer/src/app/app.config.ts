import { DEFAULT_DIALOG_CONFIG } from '@angular/cdk/dialog'
import { provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http'
import {
    ApplicationConfig,
    importProvidersFrom,
    provideBrowserGlobalErrorListeners,
    provideZoneChangeDetection,
} from '@angular/core'
import { provideRouter } from '@angular/router'
import { provideTranslateService } from '@ngx-translate/core'
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader'
import { appRoutes } from './app.routes'
import { CoreModule } from './core/core.module'
import { SharedModule } from './shared/shared.module'

export const appConfig: ApplicationConfig = {
    providers: [
        provideBrowserGlobalErrorListeners(),
        provideZoneChangeDetection({ eventCoalescing: true }),
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideRouter(appRoutes),
        // A dialog that is a route closes when its route does. CDK's default closes every dialog on
        // popstate, which would turn Back inside the settings dialog into a second navigation.
        { provide: DEFAULT_DIALOG_CONFIG, useValue: { closeOnNavigation: false } },
        importProvidersFrom(CoreModule, SharedModule),
        provideTranslateService({
            loader: provideTranslateHttpLoader({
                prefix: './i18n/',
                suffix: '.json',
                failOnError: true,
            }),
        }),
    ],
}
