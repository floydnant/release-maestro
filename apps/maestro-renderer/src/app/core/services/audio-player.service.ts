import { Injectable, signal } from '@angular/core'
import { Subject } from 'rxjs'

@Injectable({ providedIn: 'root' })
export class WebAudioPlayer {
    private audioElem: HTMLAudioElement
    private sourceNode: MediaElementAudioSourceNode
    private gainNode: GainNode
    private pendingSeekPercent = 0

    private constructor() {
        this.audioElem = new Audio()
        const audioCtx = new AudioContext()
        this.gainNode = audioCtx.createGain()
        this.gainNode.gain.value = 1
        this.gainNode.connect(audioCtx.destination)

        this.sourceNode = audioCtx.createMediaElementSource(this.audioElem)
        this.sourceNode.connect(this.gainNode)

        this.audioElem.addEventListener('pause', () => this.isPlaying.set(false))
        this.audioElem.addEventListener('play', () => this.isPlaying.set(true))
        this.audioElem.addEventListener('timeupdate', () => this.playerTime.set(this.audioElem.currentTime))
        this.audioElem.addEventListener('durationchange', () => this.updateDuration())
        this.audioElem.addEventListener('loadedmetadata', () => {
            this.updateDuration()
            this.seekTo(this.pendingSeekPercent)
        })
        this.audioElem.addEventListener('ended', () => {
            this.pause()
            this.ended$.next()
        })
        this.audioElem.addEventListener('error', e => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            switch ((e.target as any)?.error.code) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                case (e.target as any)?.error.MEDIA_ERR_ABORTED:
                    break
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                case (e.target as any)?.error.MEDIA_ERR_NETWORK:
                    this.logError('A network error caused the audio download to fail.')
                    break
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                case (e.target as any)?.error.MEDIA_ERR_DECODE:
                    this.logError('The audio playback was aborted due to a decoding issue.')
                    break
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                case (e.target as any)?.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                    this.logError(
                        'The audio could not be loaded, either because network failed or due to an issue with the format.',
                    )
                    break
                default:
                    break
            }
        })
    }

    ended$ = new Subject<void>()
    isPlaying = signal(false)
    currentUrl = signal<string | null>(null)
    playerTime = signal(0)
    duration = signal(0)

    setVolume(volume: number) {
        this.audioElem.volume = volume
    }

    seekTo(timePercent: number) {
        if (!Number.isFinite(this.audioElem.duration) || this.audioElem.duration <= 0) return

        const newTime = this.audioElem.duration * Math.min(Math.max(timePercent, 0), 1)
        this.audioElem.currentTime = newTime

        this.playerTime.set(this.audioElem.currentTime)
    }
    seekBy(seconds: number) {
        if (!Number.isFinite(this.audioElem.duration) || this.audioElem.duration <= 0) return

        const newTime = Math.min(Math.max(this.audioElem.currentTime + seconds, 0), this.audioElem.duration)
        this.audioElem.currentTime = newTime
        this.playerTime.set(newTime)
    }

    playSource(url: string, seekPercent = 0) {
        this.logInfo('Playing source', url)

        // const convertedPath = convertFileSrc(source.path).replace("?", "%3F");

        this.audioElem.pause()
        this.audioElem.currentTime = 0
        this.audioElem.src = url

        this.currentUrl.set(url)
        this.playerTime.set(0)
        this.duration.set(0)
        this.pendingSeekPercent = Math.min(Math.max(seekPercent, 0), 1)
        this.play()
    }

    play() {
        if (!this.audioElem.src) return

        this.audioElem.play().catch(err => {
            this.logError('Failed to play audio:', err)
        })

        this.playerTime.set(this.audioElem.currentTime)
    }

    pause() {
        if (this.audioElem) {
            this.audioElem.pause()
        }
    }

    togglePlay() {
        if (this.isPlaying()) {
            this.pause()
        } else {
            this.play()
        }
    }

    private updateDuration() {
        const duration = this.audioElem.duration
        this.duration.set(Number.isFinite(duration) && duration > 0 ? duration : 0)
    }

    logInfo(message: string, ...args: unknown[]) {
        // @TODO: Use proper logging
        console.log(`[${WebAudioPlayer.name.replace(/^_/, '')}] ` + message, ...args)
    }
    logError(message: string, ...args: unknown[]) {
        // @TODO: Use proper logging
        console.error(`[${WebAudioPlayer.name.replace(/^_/, '')}] ` + message, ...args)
    }
}
