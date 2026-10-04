import { provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http'
import {
    ApplicationConfig,
    ErrorHandler,
    importProvidersFrom,
    provideBrowserGlobalErrorListeners,
    provideZoneChangeDetection,
} from '@angular/core'
import { provideRouter } from '@angular/router'
import { provideTranslateService } from '@ngx-translate/core'
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader'
import { appRoutes } from './app.routes'
import { CoreModule } from './core/core.module'
import { LoggingErrorHandler } from './core/logging/logging-error-handler'
import { SharedModule } from './shared/shared.module'

export const appConfig: ApplicationConfig = {
    providers: [
        provideBrowserGlobalErrorListeners(),
        { provide: ErrorHandler, useClass: LoggingErrorHandler },
        provideZoneChangeDetection({ eventCoalescing: true }),
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideRouter(appRoutes),
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
