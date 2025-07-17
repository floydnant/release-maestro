import { Prettify } from '../../src/app/shared/utils/object.utils'
import { DiProviderNotFoundException } from './dependency-injection.exceptions'

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class CustomInjectionToken<_TValue extends object> {
    constructor(public readonly name: string) {}
}

export type InjectionToken<TValue extends object> = AnyConstructor<TValue> | CustomInjectionToken<TValue>

export type ProviderFactory<TValue> = (di: Prettify<DiContainer>) => TValue | Promise<TValue>

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
 *
 * It can be used to define a factory function that creates an instance of a given type or directly provide a value.
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

// @TODO: implement scopes (child containers)
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
     *
     * If invoked with the given injection token for the first time, resolves the value by
     * calling the factory function and resolving its dependencies.
     * Otherwise, returns the cached value.
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

        // @TODO: implement context awareness: mention dependant provider (i.e. "while resolving provider X, could not resolve Y")
        throw new DiProviderNotFoundException(injectionToken)
    }

    /**
     * If called directly on the global `DiContainer` instance, registers a global destroy hook
     * that will be called when `destroyAll()` is called.
     *
     * If called from within a provider's `useFactory()`, registers a destroy hook for the specific injection token
     * which can be invoked by calling `destroy(injectionToken)` as well as `destroyAll()`.
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

        const value = await provider.useFactory({
            // Neither the spread-operator nor Object.assign() can be used here, as they mess
            // with the instance methods (they don't properly copy the methods and their `this` context)

            get: this.get.bind(this),
            // Scope the cleanup function to the injection token
            registerOnDestroy: cleanUpFn => {
                this.instanceOnDestroyFns.set(provider.provide, cleanUpFn)
            },
            overrideProvider: this.overrideProvider.bind(this),
            destroy: this.destroy.bind(this),
            destroyAll: this.destroyAll.bind(this),
        })

        if (typeof value == 'object' && PROVIDER_INIT in value && typeof value[PROVIDER_INIT] == 'function') {
            const initFn = value[PROVIDER_INIT]
            await initFn.call(value)
        }

        if (this.config.debugLogs) console.groupEnd()

        return value
    }

    /**
     * Returns the value for the given injection token if it exists in the current
     * scope (or in the parent scope if `traverseParentScopes: true` is passed).
     */
    private getValue<TValue extends object>(injectionToken: InjectionToken<TValue>): TValue | undefined {
        const value = this.instances.get(injectionToken) as TValue | undefined
        return value
    }

    /**
     * Returns the provider for the given injection token if it exists in the current
     * scope (or in the parent scope if `traverseParentScopes: true` is passed).
     */
    private getProvider<TValue extends object>(
        injectionToken: InjectionToken<TValue>,
    ): Provider<InjectionToken<TValue>> | undefined {
        const provider = this.config.providers.find(p => p.provide == injectionToken)
        if (provider) return provider

        if (this.config.debugLogs) {
            console.debug(`No provider for '${injectionToken.name}' in the current scope`)
        }

        return undefined
    }

    /**
     * Overrides the provider for the given injection token.
     *
     * This is useful for overriding providers in tests or in specific use-cases.
     *
     * **CAUTION:** This will override the provider in place, meaning, all future
     * instantiations of the given injection token will use the new provider.
     *
     * If there is already an instance of the given injection token or dependants of it,
     * this will have no effect unless you manually call `destroy(injectionToken)`
     * to destroy the instance and re-instantiate it.
     */
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

    /**
     * Destroys the value for the given injection token as well as invoking
     * the associated destroy hook, if there is one.
     */
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

    /**
     * Destroys all instances and calls all destroy hooks.
     */
    async destroyAll(): Promise<void> {
        if (this.config.debugLogs) console.group('Destroying all instances')

        await Promise.all(Array.from(this.instances.keys()).map(token => this.destroy(token)))
        await Promise.all(this.globalOnDestroyFns.map(fn => fn()))

        if (this.config.debugLogs) console.groupEnd()
    }
}
