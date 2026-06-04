import { DiProviderNotFoundException } from './dependency-injection.exceptions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConstructor<TInstance> = new (...args: any[]) => TInstance

/**
 * Symbol to identify a provider method that is called automatically
 * by the dependency injection system when the provider is instantiated
 */
export const PROVIDER_INIT = Symbol('PROVIDER_INIT')
/**
 * Symbol to identify a provider method that is called automatically
 * by the dependency injection system when the provider is destroyed
 */
export const PROVIDER_DESTROY = Symbol('PROVIDER_DESTROY')

export class CustomInjectionToken<TValue extends object> {
    constructor(public readonly name: string) {}
    
    // This property exists only for type inference, never at runtime
    private readonly _value!: TValue
}

export type InjectionToken<TValue extends object> = AnyConstructor<TValue> | CustomInjectionToken<TValue>

export type ProviderFactory<TValue> = (di: DiContainer) => TValue | Promise<TValue>

export type ValueProvider<TInjectionToken extends InjectionToken<object>> = {
    provide: TInjectionToken
    useValue: TInjectionToken extends InjectionToken<infer V> ? V : never
}
export type FactoryProvider<TInjectionToken extends InjectionToken<object>> = {
    provide: TInjectionToken
    useFactory: ProviderFactory<TInjectionToken extends InjectionToken<infer V> ? V : never>
}

/**
 * A provider is a configuration object that describes how to resolve an injection token.
 */
export type Provider<TInjectionToken extends InjectionToken<object>> =
    | ValueProvider<TInjectionToken>
    | FactoryProvider<TInjectionToken>

export type OnDestroyFn = () => void | Promise<void>

export const isValueProvider = <TValue extends object>(
    provider: Provider<InjectionToken<TValue>>,
): provider is ValueProvider<InjectionToken<TValue>> => 'useValue' in provider
export const isFactoryProvider = <TValue extends object>(
    provider: Provider<InjectionToken<TValue>>,
): provider is FactoryProvider<InjectionToken<TValue>> => 'useFactory' in provider

export class DiContainer {
    constructor(
        private config: {
            providers: Provider<InjectionToken<object>>[]
            debugLogs?: boolean
        },
    ) {
        // If multiple providers are registered for the same injection token, the last one defined should be used.
        this.config.providers.reverse()
    }

    private instances = new Map<InjectionToken<object>, object>()
    private instanceOnDestroyFns = new Map<InjectionToken<object>, OnDestroyFn>()
    private globalOnDestroyFns: OnDestroyFn[] = []

    /**
     * Resolves the value for the given injection token.
     */
    async get<TValue extends object>(injectionToken: InjectionToken<TValue>): Promise<TValue> {
        if (this.config.debugLogs) {
            console.group(`Retrieving '${injectionToken.name}'`)
        }

        // check current scope's cache
        const cachedValue = this.getValue(injectionToken)
        if (cachedValue) {
            if (this.config.debugLogs) {
                console.debug(`Found cached value for '${injectionToken.name}'`)
                console.groupEnd()
            }

            return cachedValue as TValue
        }

        // check current scope's providers
        const provider = this.getProvider(injectionToken)
        if (provider) {
            const value = await this.initProvider(provider)
            this.instances.set(injectionToken, value)

            if (this.config.debugLogs) console.groupEnd()

            return value as TValue
        }

        if (this.config.debugLogs) console.groupEnd()

        throw new DiProviderNotFoundException(injectionToken)
    }

    /**
     * Registers a destroy hook that will be called when `destroyAll()` is called.
     */
    registerOnDestroy(onDestroy: OnDestroyFn): void {
        this.globalOnDestroyFns.push(onDestroy)
    }

    private async initProvider<TValue extends object>(
        provider: Provider<InjectionToken<TValue>>,
    ): Promise<TValue> {
        if (this.config.debugLogs) {
            console.group(`Instantiating '${provider.provide.name}'`)
        }

        if (isValueProvider(provider)) {
            if (this.config.debugLogs) console.groupEnd()

            return provider.useValue
        }

        const value = await provider.useFactory(this)

        if (typeof value == 'object' && PROVIDER_INIT in value && typeof value[PROVIDER_INIT] == 'function') {
            const initFn = value[PROVIDER_INIT]
            await initFn.call(value)
        }

        if (this.config.debugLogs) console.groupEnd()

        return value
    }

    private getValue<TValue extends object>(injectionToken: InjectionToken<TValue>): TValue | undefined {
        const value = this.instances.get(injectionToken) as TValue | undefined
        return value
    }

    private getProvider<TValue extends object>(
        injectionToken: InjectionToken<TValue>,
    ): Provider<InjectionToken<TValue>> | undefined {
        const provider = this.config.providers.find(p => p.provide == injectionToken)
        if (provider) return provider as Provider<InjectionToken<TValue>>

        if (this.config.debugLogs) {
            console.debug(`No provider for '${injectionToken.name}' in the current scope`)
        }

        return undefined
    }

    overrideProvider(provider: Provider<InjectionToken<object>>): DiContainer {
        const existingProviderIndex = this.config.providers.findIndex(p => p.provide == provider.provide)

        if (existingProviderIndex == -1) {
            if (this.config.debugLogs) {
                console.debug(
                    `Tried overriding '${provider.provide.name}' but no existing provider was found. Adding`,
                    provider,
                    'instead.',
                )
            }

            this.config.providers.unshift(provider)
            return this
        }

        const [originalProvider] = this.config.providers.splice(existingProviderIndex, 1, provider)
        if (this.config.debugLogs) {
            console.debug('Overridden provider', originalProvider, 'with', provider)
        }

        return this
    }

    async destroy(injectionToken: InjectionToken<object>): Promise<void> {
        if (this.config.debugLogs) {
            console.debug(`Destroying '${injectionToken.name}'`)
        }

        const instance = this.instances.get(injectionToken)
        if (
            typeof instance == 'object' &&
            PROVIDER_DESTROY in instance &&
            typeof instance[PROVIDER_DESTROY] == 'function'
        ) {
            const internalDestroyFn = instance[PROVIDER_DESTROY]
            await internalDestroyFn.call(instance)
        }

        const externalDestroyFn = this.instanceOnDestroyFns.get(injectionToken)
        await externalDestroyFn?.()

        this.instances.delete(injectionToken)
        this.instanceOnDestroyFns.delete(injectionToken)
    }

    async destroyAll(): Promise<void> {
        if (this.config.debugLogs) console.group('Destroying all instances')

        await Promise.all(Array.from(this.instances.keys()).map(token => this.destroy(token)))
        await Promise.all(this.globalOnDestroyFns.map(fn => fn()))

        if (this.config.debugLogs) console.groupEnd()
    }
}