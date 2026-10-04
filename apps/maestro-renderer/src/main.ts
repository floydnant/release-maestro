import { enableProdMode } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import { AppComponent } from './app/app.component'
import { appConfig } from './app/app.config'
import { webEnv } from './environments/environment'
import { createRendererLogger } from './app/core/logging/logger'

const log = createRendererLogger('bootstrap')

if (webEnv.production) {
    enableProdMode()
}

bootstrapApplication(AppComponent, appConfig).catch(err => log.error('renderer.bootstrap.failed', err))
