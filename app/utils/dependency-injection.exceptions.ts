import { Exception } from '../base.exceptions'
import { InjectionToken } from './dependency-injection.util'

export class DiProviderNotFoundException extends Exception {
    constructor(injectionToken: InjectionToken<object>) {
        super(`No provider found for '${injectionToken.name}', forgot to add it to the DI config?`)
    }
}
