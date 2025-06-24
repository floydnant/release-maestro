import { InjectionToken } from './dependency-injection.util'

export class DiProviderNotFoundException extends Error {
    constructor(injectionToken: InjectionToken<object>) {
        super(`No provider found for '${injectionToken.name}', forgot to add it to the DI config?`)
    }
}
