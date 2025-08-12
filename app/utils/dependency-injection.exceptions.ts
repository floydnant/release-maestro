import { Exception } from '../base.exceptions'
import { InjectionToken } from './dependency-injection.util'

export class DiProviderNotFoundException extends Exception {
    constructor(injectionToken: InjectionToken<object>) {
        super(
            `No provider found for '${injectionToken.name}', forgot to add it to the DI config?`,
            'A required part of the app is not properly configured. Please contact support if this error persists.',
        )
    }
}
