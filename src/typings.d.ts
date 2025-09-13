/* SystemJS module definition */
declare const nodeModule: NodeModule
interface NodeModule {
    id: string
}
interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    require: any
}
