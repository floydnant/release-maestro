import { ErrorHandler, Injectable } from '@angular/core'
import { createRendererLogger } from './logger'

const log = createRendererLogger('angular')

@Injectable()
export class LoggingErrorHandler implements ErrorHandler {
    handleError(error: unknown): void {
        log.error('angular.unhandled-error', error)
    }
}
