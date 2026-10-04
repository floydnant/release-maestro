import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { fromPartial } from '@total-typescript/shoehorn'
import { SidecarProcessService } from './sidecar-process.service'

jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    spawn: jest.fn(),
}))

jest.mock('../../logging/logger', () => ({
    createMainLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
    isDebugLoggingEnabled: () => false,
    writeDiagnosticEntry: jest.fn(),
}))

const fakeChild = () =>
    Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        killed: false,
        pid: 123,
        kill: jest.fn(),
    })

describe('SidecarProcessService', () => {
    it.each<[{ exitCode: number | null; signalCode: NodeJS.Signals | null }]>([
        [{ exitCode: 1, signalCode: null }],
        [{ exitCode: null, signalCode: 'SIGKILL' }],
    ])('rejects old requests when the worker exits before its streams close (%o)', async exit => {
        const oldChild = fakeChild()
        const newChild = fakeChild()
        jest.mocked(spawn)
            .mockReturnValueOnce(fromPartial(oldChild))
            .mockReturnValueOnce(fromPartial(newChild))
        const service = new SidecarProcessService('metadata-engine')

        const first = service.startRequest('scan', {})
        const firstRejection = expect(first.done).rejects.toThrow('exited before its streams closed')
        // Node sets either exitCode or signalCode before 'close' after stdio drains.
        oldChild.exitCode = exit.exitCode
        oldChild.signalCode = exit.signalCode

        const replacement = service.startRequest('cancel', { requestId: first.id })
        await firstRejection

        oldChild.stdout.end()
        oldChild.stderr.end()
        oldChild.emit('close', exit.exitCode, exit.signalCode)
        newChild.stdout.write(`${JSON.stringify({ type: 'response', id: replacement.id, ok: true })}\n`)
        await expect(replacement.done).resolves.toMatchObject({ ok: true })

        service.stop()
    })
})
