import type { Prettify } from '../utils/object.utils'

export enum ExternalRefKeys {
    MusicBrainzTrackId = 'MUSICBRAINZ_TRACK_ID',
    MusicBrainzReleaseId = 'MUSICBRAINZ_RELEASE_ID',
    MusicBrainzReleaseGroupId = 'MUSICBRAINZ_RELEASE_GROUP_ID',
    MusicBrainzReleaseArtistId = 'MUSICBRAINZ_RELEASE_ARTIST_ID',
    MusicBrainzReleaseTrackId = 'MUSICBRAINZ_RELEASE_TRACK_ID',
    MusicBrainzRecordingId = 'MUSICBRAINZ_RECORDING_ID',
    MusicBrainzWorkId = 'MUSICBRAINZ_WORK_ID',
    MusicBrainzArtistId = 'MUSICBRAINZ_ARTIST_ID',
    MusicBrainzLabelId = 'MUSICBRAINZ_LABEL_ID',
    MusicBrainzAlbumId = 'MUSICBRAINZ_ALBUM_ID',
    MusicBrainzAlbumArtistId = 'MUSICBRAINZ_ALBUM_ARTIST_ID',

    AcoustIdId = 'ACOUSTID_ID',
    Isrc = 'ISRC',
    Barcode = 'BARCODE',
    Asin = 'ASIN',

    SpotifyTrackId = 'SPOTIFY_TRACK_ID',
    SpotifyReleaseId = 'SPOTIFY_RELEASE_ID',
    DeezerTrackId = 'DEEZER_TRACK_ID',
    DeezerReleaseId = 'DEEZER_RELEASE_ID',
    TraxsourceTrackId = 'TRAXSOURCE_TRACK_ID',
    TraxsourceReleaseId = 'TRAXSOURCE_RELEASE_ID',
    BeatsourceTrackId = 'BEATSOURCE_TRACK_ID',
    BeatsourceReleaseId = 'BEATSOURCE_RELEASE_ID',
    ItunesTrackId = 'ITUNES_TRACK_ID',
    ItunesReleaseId = 'ITUNES_RELEASE_ID',
    JunodownloadReleaseId = 'JUNODOWNLOAD_RELEASE_ID',

    BandcampUrl = 'BANDCAMP_URL',
    BandcampTrackId = 'BANDCAMP_TRACK_ID',
    BandcampReleaseId = 'BANDCAMP_RELEASE_ID',
    BandcampAlbumId = 'BANDCAMP_ALBUM_ID',
    BandcampLabelId = 'BANDCAMP_LABEL_ID',
    BandcampLabelUrl = 'BANDCAMP_LABEL_URL',
    BandcampArtistId = 'BANDCAMP_ARTIST_ID',

    DiscogsReleaseId = 'DISCOGS_RELEASE_ID',
    DiscogsMasterReleaseId = 'DISCOGS_MASTER_RELEASE_ID',
    DiscogsArtistId = 'DISCOGS_ARTIST_ID',
    DiscogsLabelId = 'DISCOGS_LABEL_ID',
    DiscogsArtistLink = 'DISCOGS_ARTIST_LINK',
    DiscogsLabelLink = 'DISCOGS_LABEL_LINK',

    BeatportTrackId = 'BEATPORT_TRACK_ID',
    BeatportTrackUrl = 'BEATPORT_TRACK_URL',
    BeatportReleaseId = 'BEATPORT_RELEASE_ID',
    BeatportLabelUrl = 'BEATPORT_LABEL_URL',
    BeatportArtistUrl = 'BEATPORT_ARTIST_URL',
}
export type ExternalRefs = Prettify<Partial<Record<ExternalRefKeys, string[]>>>
