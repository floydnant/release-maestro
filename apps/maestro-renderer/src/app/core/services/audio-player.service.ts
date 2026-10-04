import { Injectable, signal } from '@angular/core'
import { Subject } from 'rxjs'
import { createRendererLogger } from '../logging/logger'

const log = createRendererLogger('audio-player')

@Injectable({ providedIn: 'root' })
export class WebAudioPlayer {
    private audioElem: HTMLAudioElement
    private sourceNode: MediaElementAudioSourceNode
    private gainNode: GainNode
    private pendingSeekPercent = 0
    private playRequestId = 0

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
        this.audioElem.addEventListener('playing', () => this.isLoading.set(false))
        this.audioElem.addEventListener('waiting', () => this.isLoading.set(true))
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
            this.isLoading.set(false)
            const mediaError = (e.target as HTMLAudioElement | null)?.error
            switch (mediaError?.code) {
                case mediaError?.MEDIA_ERR_NETWORK:
                case mediaError?.MEDIA_ERR_DECODE:
                case mediaError?.MEDIA_ERR_SRC_NOT_SUPPORTED:
                    log.warn('audio.media.failed', { errorCode: mediaError.code })
                    break
                default:
                    break
            }
        })
    }

    ended$ = new Subject<void>()
    isPlaying = signal(false)
    isLoading = signal(false)
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
        log.debug('audio.source.selected')

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

        const requestId = ++this.playRequestId
        this.isLoading.set(true)
        this.audioElem.play().catch(err => {
            if (requestId == this.playRequestId) this.isLoading.set(false)
            log.error('audio.play.failed', err)
        })

        this.playerTime.set(this.audioElem.currentTime)
    }

    pause() {
        if (this.audioElem) {
            this.playRequestId++
            this.audioElem.pause()
            this.isLoading.set(false)
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
}
