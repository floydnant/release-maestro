import { signal } from '@angular/core'
import { fromPartial } from '@total-typescript/shoehorn'
import { Prettify } from '@release-maestro/core'
import { NEVER, Subject } from 'rxjs'
import { WebAudioPlayer } from '../app/core/services/audio-player.service'

export const provideWebAudioPlayerMock = () => ({
    provide: WebAudioPlayer,
    useValue: {
        play: jest.fn(),
        pause: jest.fn(),
        setVolume: jest.fn(),
        seekTo: jest.fn(),
        seekBy: jest.fn(),
        isPlaying: signal(false),
        isLoading: signal(false),
        currentUrl: signal(null),
        playerTime: signal(0),
        duration: signal(0),
        ended$: fromPartial<Subject<void>>({
            next: jest.fn(),
            pipe: () => NEVER,
            asObservable: () => NEVER,
        }),
        logInfo: jest.fn(),
        logError: jest.fn(),
        playSource: jest.fn(),
        togglePlay: jest.fn(),
    } satisfies Prettify<WebAudioPlayer>,
})
