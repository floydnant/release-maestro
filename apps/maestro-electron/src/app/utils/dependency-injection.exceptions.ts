import { InjectionToken } from './dependency-injection.util'

export class DiProviderNotFoundException extends Error {
    constructor(injectionToken: InjectionToken<object>) {
        super(`Provider for '${injectionToken.name}' not found`)
    }
}
