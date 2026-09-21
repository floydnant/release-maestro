import { TestBed } from '@angular/core/testing'
import { WebAudioPlayer } from './audio-player.service'

class FakeAudio extends EventTarget {
    currentTime = 0
    duration = 180
    src = ''
    volume = 1
    error = {
        code: 0,
        MEDIA_ERR_ABORTED: 1,
        MEDIA_ERR_NETWORK: 2,
        MEDIA_ERR_DECODE: 3,
        MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
    }

    pause = jest.fn()
    play = jest.fn(() => Promise.resolve())
}

const deferred = () => {
    let reject!: (reason?: unknown) => void
    const promise = new Promise<void>((_, rejectPromise) => {
        reject = rejectPromise
    })

    return { promise, reject }
}

describe(WebAudioPlayer.name, () => {
    let audio: FakeAudio
    let player: WebAudioPlayer
    let originalAudioContext: PropertyDescriptor | undefined

    beforeEach(() => {
        audio = new FakeAudio()
        jest.spyOn(globalThis, 'Audio').mockImplementation(() => audio as unknown as HTMLAudioElement)

        originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
        Object.defineProperty(globalThis, 'AudioContext', {
            configurable: true,
            value: jest.fn(() => ({
                createGain: () => ({ gain: { value: 0 }, connect: jest.fn() }),
                createMediaElementSource: () => ({ connect: jest.fn() }),
                destination: {},
            })),
        })

        TestBed.configureTestingModule({})
        player = TestBed.inject(WebAudioPlayer)
        jest.spyOn(player, 'logInfo').mockImplementation()
        jest.spyOn(player, 'logError').mockImplementation()
    })

    afterEach(() => {
        jest.restoreAllMocks()
        if (originalAudioContext) {
            Object.defineProperty(globalThis, 'AudioContext', originalAudioContext)
        } else {
            Reflect.deleteProperty(globalThis, 'AudioContext')
        }
    })

    it('tracks loading from playback events without treating stalled as waiting', () => {
        player.playSource('https://example.com/preview.mp3')
        expect(player.isLoading()).toBe(true)

        audio.dispatchEvent(new Event('playing'))
        expect(player.isLoading()).toBe(false)

        audio.dispatchEvent(new Event('stalled'))
        expect(player.isLoading()).toBe(false)

        audio.dispatchEvent(new Event('waiting'))
        expect(player.isLoading()).toBe(true)

        player.pause()
        expect(player.isLoading()).toBe(false)

        player.play()
        audio.dispatchEvent(new Event('error'))
        expect(player.isLoading()).toBe(false)
    })

    it('does not let an older rejected play request clear the current loading state', async () => {
        const firstPlay = deferred()
        const secondPlay = deferred()
        audio.play.mockReturnValueOnce(firstPlay.promise).mockReturnValueOnce(secondPlay.promise)

        player.playSource('https://example.com/first.mp3')
        player.playSource('https://example.com/second.mp3')

        firstPlay.reject(new Error('First request aborted'))
        await firstPlay.promise.catch(() => undefined)
        expect(player.isLoading()).toBe(true)

        secondPlay.reject(new Error('Second request failed'))
        await secondPlay.promise.catch(() => undefined)
        expect(player.isLoading()).toBe(false)
    })
})
