import bandcampFetch, { Album, Artist, Label, Track } from 'bandcamp-fetch'

export class BandcampApiBackendService {
    async fetchAlbum(url: string): Promise<Album> {
        return await bandcampFetch.album.getInfo({ albumUrl: url })
    }

    async fetchTrack(url: string): Promise<Track> {
        return await bandcampFetch.track.getInfo({ trackUrl: url })
    }

    async fetchBand(url: string): Promise<Label | Artist> {
        return await bandcampFetch.band.getInfo({ bandUrl: url })
    }

    async fetchRelease(url: string): Promise<Album | Track> {
        const isTrack = url.includes('/track/')
        if (isTrack) {
            return await bandcampFetch.track.getInfo({ trackUrl: url })
        }
        return await bandcampFetch.album.getInfo({ albumUrl: url })
    }
}
