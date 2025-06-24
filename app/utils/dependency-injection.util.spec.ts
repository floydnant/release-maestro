import { DiProviderNotFoundException } from './dependency-injection.exceptions'
import {
    CustomInjectionToken,
    DiContainer,
    PROVIDER_DESTROY,
    PROVIDER_INIT,
} from './dependency-injection.util'

describe('Dependency Injection', () => {
    describe(DiContainer.name, () => {
        class MyService {
            hello = () => 'world'
        }

        class MyOtherService {
            constructor(private myService: MyService) {}
            greet = () => 'Hello ' + this.myService.hello()
        }

        const MY_INJECTION_TOKEN = new CustomInjectionToken<{
            value: string
        }>('MY_INJECTION_TOKEN')

        describe('resolving tokens', () => {
            it('can resolve value providers', async () => {
                const di = new DiContainer({
                    providers: [{ provide: MyService, useValue: new MyService() }],
                })

                const myService = await di.get(MyService)
                expect(myService).toBeInstanceOf(MyService)
            })
            it('throws if unable to resolve value providers', async () => {
                const di = new DiContainer({
                    providers: [
                        // MyService is not provided
                    ],
                })

                expect(() => di.get(MyService)).rejects.toThrow(DiProviderNotFoundException)
            })

            it('can resolve factory providers', async () => {
                const di = new DiContainer({
                    providers: [{ provide: MyService, useFactory: () => new MyService() }],
                })

                const myService = await di.get(MyService)
                expect(myService).toBeInstanceOf(MyService)
            })
            it("calls a provider's factory only once", async () => {
                const onFactoryInvocation = jest.fn().mockReturnValue(new MyService())

                const di = new DiContainer({
                    providers: [{ provide: MyService, useFactory: onFactoryInvocation }],
                })

                expect(await di.get(MyService)).toBeInstanceOf(MyService)
                expect(await di.get(MyService)).toBeInstanceOf(MyService)
                expect(await di.get(MyService)).toBeInstanceOf(MyService)
                expect(onFactoryInvocation).toHaveBeenCalledTimes(1)
            })
            it('throws if unable to resolve factory providers', async () => {
                const di = new DiContainer({
                    providers: [
                        // MyService is not provided
                    ],
                })

                expect(() => di.get(MyService)).rejects.toThrow(DiProviderNotFoundException)
            })

            it("can resolve a factory provider's dependencies", async () => {
                const di = new DiContainer({
                    providers: [
                        { provide: MyService, useFactory: () => new MyService() },
                        {
                            provide: MyOtherService,
                            useFactory: async di => new MyOtherService(await di.get(MyService)),
                        },
                    ],
                })

                const myOtherService = await di.get(MyOtherService)
                expect(myOtherService).toBeInstanceOf(MyOtherService)
            })
            it("throws if unable to resolve a factory provider's dependencies", async () => {
                const di = new DiContainer({
                    providers: [
                        // MyService is not provided
                        {
                            provide: MyOtherService,
                            useFactory: async di => new MyOtherService(await di.get(MyService)),
                        },
                    ],
                })

                await expect(() => di.get(MyOtherService)).rejects.toThrow(DiProviderNotFoundException)
            })

            describe('overrides', () => {
                it('can override providers (no cache)', async () => {
                    const di = new DiContainer({
                        providers: [{ provide: MY_INJECTION_TOKEN, useValue: { value: '1' } }],
                    })

                    di.overrideProvider({
                        provide: MY_INJECTION_TOKEN,
                        useValue: { value: '2' },
                    })

                    const myValue = await di.get(MY_INJECTION_TOKEN)
                    expect(myValue.value).toBe('2')
                })
            })

            describe('prioritization', () => {
                it('if multiple providers register the same injection token, the last one wins', async () => {
                    const di = new DiContainer({
                        providers: [
                            { provide: MY_INJECTION_TOKEN, useValue: { value: '1' } },
                            { provide: MY_INJECTION_TOKEN, useValue: { value: '2' } },
                        ],
                    })

                    const myValue = await di.get(MY_INJECTION_TOKEN)
                    expect(myValue.value).toBe('2')
                })
            })
        })

        describe('cleaning up', () => {
            it('can destroy a value', async () => {
                const onFactoryInvocation = jest.fn().mockReturnValue(new MyService())

                const di = new DiContainer({
                    providers: [{ provide: MyService, useFactory: onFactoryInvocation }],
                })

                const myService = await di.get(MyService)
                expect(myService).toBeInstanceOf(MyService)
                expect(onFactoryInvocation).toHaveBeenCalledTimes(1)

                await di.destroy(MyService)
                await di.get(MyService) // should need to re-invoke the factory
                expect(onFactoryInvocation).toHaveBeenCalledTimes(2)
            })

            it(`invokes internal destroy hooks upon calling ${DiContainer.prototype.destroy.name}()`, async () => {
                const myCleanupFn = jest.fn()
                const myOtherCleanupFn = jest.fn()
                const globalCleanupFn = jest.fn()

                class MyService {
                    hello = () => 'world';

                    [PROVIDER_DESTROY]() {
                        myCleanupFn()
                    }
                }
                const di = new DiContainer({
                    providers: [
                        {
                            provide: MyService,
                            useFactory: () => {
                                return new MyService()
                            },
                        },
                        {
                            provide: MyOtherService,
                            useFactory: async di => {
                                di.registerOnDestroy(myOtherCleanupFn)
                                return new MyOtherService(await di.get(MyService))
                            },
                        },
                    ],
                })
                di.registerOnDestroy(globalCleanupFn)

                expect(await di.get(MyService)).toBeInstanceOf(MyService)
                expect(await di.get(MyOtherService)).toBeInstanceOf(MyOtherService)

                await di.destroy(MyService)
                expect(myCleanupFn).toHaveBeenCalled()
                expect(myOtherCleanupFn).not.toHaveBeenCalled()
                expect(globalCleanupFn).not.toHaveBeenCalled()
            })

            it(`invokes external destroy hooks upon calling ${DiContainer.prototype.destroy.name}()`, async () => {
                const myCleanupFn = jest.fn()
                const myOtherCleanupFn = jest.fn()
                const globalCleanupFn = jest.fn()

                const di = new DiContainer({
                    providers: [
                        {
                            provide: MyService,
                            useFactory: di => {
                                di.registerOnDestroy(myCleanupFn)
                                return new MyService()
                            },
                        },
                        {
                            provide: MyOtherService,
                            useFactory: di => {
                                di.registerOnDestroy(myOtherCleanupFn)
                                return new MyOtherService(new MyService())
                            },
                        },
                    ],
                })
                di.registerOnDestroy(globalCleanupFn)

                expect(await di.get(MyService)).toBeInstanceOf(MyService)
                expect(await di.get(MyOtherService)).toBeInstanceOf(MyOtherService)

                await di.destroy(MyService)
                expect(myCleanupFn).toHaveBeenCalled()
                expect(myOtherCleanupFn).not.toHaveBeenCalled()
                expect(globalCleanupFn).not.toHaveBeenCalled()
            })

            it(`invokes all destroy hooks upon calling ${DiContainer.prototype.destroyAll.name}()`, async () => {
                const myCleanupFn = jest.fn()
                const myOtherCleanupFn = jest.fn()
                const globalCleanupFn = jest.fn()

                const di = new DiContainer({
                    providers: [
                        {
                            provide: MyService,
                            useFactory: di => {
                                di.registerOnDestroy(myCleanupFn)
                                return new MyService()
                            },
                        },
                        {
                            provide: MyOtherService,
                            useFactory: di => {
                                di.registerOnDestroy(myOtherCleanupFn)
                                return new MyOtherService(new MyService())
                            },
                        },
                    ],
                })
                di.registerOnDestroy(globalCleanupFn)

                expect(await di.get(MyService)).toBeInstanceOf(MyService)
                expect(await di.get(MyOtherService)).toBeInstanceOf(MyOtherService)

                await di.destroyAll()
                expect(myCleanupFn).toHaveBeenCalled()
                expect(myOtherCleanupFn).toHaveBeenCalled()
                expect(globalCleanupFn).toHaveBeenCalled()
            })
        })
    })
})
