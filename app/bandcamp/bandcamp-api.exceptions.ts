import { Exception } from '../base.exceptions'

export class BandcampApiException extends Exception {}

export class BandcampApiErrorWhileFetchingTralbumException extends BandcampApiException {
    constructor(
        public url: string,
        public status: number,
    ) {
        super(
            `Failed to fetch tralbum info from ${url} (status: ${status})`,
            status == 404
                ? 'The Bandcamp track or album could not be found'
                : 'An error occurred while fetching the Bandcamp track or album',
        )
    }
}

export class BandcampApiMalformedTralbumDataException extends BandcampApiException {
    constructor(
        public url: string,
        public originalEror?: Error,
    ) {
        super(
            `Failed to parse tralbum data from ${url}`,
            "We weren't able to retrieve the album or track data from Bandcamp. This is likely due to a change in the Bandcamp website structure.",
        )
    }
}
