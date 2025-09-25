/* SystemJS module definition */
declare const nodeModule: NodeModule
interface NodeModule {
    id: string
}
// @TODO: add proper types
interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    require: any
}
