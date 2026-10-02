# External reference tags

Research for [MAE-136](https://linear.app/floyd-haremsa/issue/MAE-136/check-if-there-are-more-common-metadata-fields-for-external-refs), checked 2026-09-29.

The strongest additions are identifiers with documented file tags or an implementation that writes them. An API identifier alone does not establish a file-tag convention. These sources establish interoperability, not how often a field occurs across users' libraries.

## Additions in MAE-136

| Reference      | File field names                                                                    | Entity scope                 |
| -------------- | ----------------------------------------------------------------------------------- | ---------------------------- |
| AcoustID       | `ACOUSTID_ID`, ID3 description `Acoustid Id`, MP4 Apple freeform name `Acoustid Id` | Track                        |
| ISRC           | `ISRC`, ID3 frame `TSRC`, MP4 Apple freeform name `ISRC`                            | Recording, retained on track |
| Barcode        | `BARCODE`, aliases `UPC`, `EAN`, `EAN/UPN`, `UPN`                                   | Album                        |
| Amazon product | `ASIN`                                                                              | Album                        |

[Picard's tag mapping](https://picard-docs.musicbrainz.org/en/latest/appendices/tag_mapping.html) documents AcoustID, ISRC, barcode and ASIN storage. [MediaFile's mappings](https://github.com/beetbox/mediafile/blob/faaf7444f1c58d6a39f0ba51dad8ea43a71fdf3a/mediafile/__init__.py#L591-L627) confirm the barcode aliases. Preserve barcode strings, including leading zeroes.

AcoustID IDs and acoustic fingerprints are different values. The ID is a reference; the fingerprint describes audio. [Picard's field definitions](https://picard-docs.musicbrainz.org/en/latest/variables/tags_basic.html) also distinguish release barcodes and Amazon products from recording ISRCs.

| Discogs reference | File field name             | Entity scope |
| ----------------- | --------------------------- | ------------ |
| Artist            | `DISCOGS_ARTIST_ID`         | Artist       |
| Label             | `DISCOGS_LABEL_ID`          | Record label |
| Master release    | `DISCOGS_MASTER_RELEASE_ID` | Album        |

The music-metadata parser explicitly recognizes these names in [ID3 user text frames](https://github.com/Borewit/music-metadata/blob/ec12f8a58724f7f28d3c470977596d104367b9c9/lib/id3v2/ID3v24TagMapper.ts#L118-L130) and [Vorbis comments](https://github.com/Borewit/music-metadata/blob/ec12f8a58724f7f28d3c470977596d104367b9c9/lib/ogg/vorbis/VorbisTagMapper.ts#L94-L106). Keep master release and release identifiers separate. The research did not establish `DISCOGS_MASTER_ID` as an equivalent file field.

## Store identifiers written by OneTagger

OneTagger writes `{PLATFORM}_TRACK_ID` and `{PLATFORM}_RELEASE_ID` when enabled and supplied by a platform adapter. This is explicit in its [tag writer](https://github.com/Marekkon5/onetagger/blob/36523f71f2d9a5947912f3cb930f1a31fcb2e3ee/crates/onetagger-autotag/src/lib.rs#L226-L233). The adapters establish the following concrete fields.

| Platform      | Fields                                         | Source                                                                                                                                                                      |
| ------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spotify       | `SPOTIFY_TRACK_ID`, `SPOTIFY_RELEASE_ID`       | [Spotify adapter](https://github.com/Marekkon5/onetagger/blob/36523f71f2d9a5947912f3cb930f1a31fcb2e3ee/crates/onetagger-platforms/src/spotify.rs#L235-L248)                 |
| Deezer        | `DEEZER_TRACK_ID`, `DEEZER_RELEASE_ID`         | [Deezer adapter](https://github.com/Marekkon5/onetagger/blob/36523f71f2d9a5947912f3cb930f1a31fcb2e3ee/crates/onetagger-platforms/src/deezer.rs#L174-L187)                   |
| Traxsource    | `TRAXSOURCE_TRACK_ID`, `TRAXSOURCE_RELEASE_ID` | [Track and release extraction](https://github.com/Marekkon5/onetagger/blob/36523f71f2d9a5947912f3cb930f1a31fcb2e3ee/crates/onetagger-platforms/src/traxsource.rs#L105-L142) |
| Beatsource    | `BEATSOURCE_TRACK_ID`, `BEATSOURCE_RELEASE_ID` | [Beatsource adapter](https://github.com/Marekkon5/onetagger/blob/36523f71f2d9a5947912f3cb930f1a31fcb2e3ee/crates/onetagger-platforms/src/beatsource.rs#L98-L120)            |
| iTunes        | `ITUNES_TRACK_ID`, `ITUNES_RELEASE_ID`         | [iTunes adapter](https://github.com/Marekkon5/onetagger/blob/36523f71f2d9a5947912f3cb930f1a31fcb2e3ee/crates/onetagger-platforms/src/itunes.rs#L113-L121)                   |
| Juno Download | `JUNODOWNLOAD_RELEASE_ID`                      | [Juno Download adapter](https://github.com/Marekkon5/onetagger/blob/36523f71f2d9a5947912f3cb930f1a31fcb2e3ee/crates/onetagger-platforms/src/junodownload.rs#L147-L161)      |

Track identifiers belong on tracks. Release identifiers also belong on albums. Spotify and Deezer's release fields contain their album IDs; iTunes' release field contains its collection ID. Do not invent a Juno track field from this evidence.

## Other documented candidates

Picard documents `MUSICBRAINZ_DISCID`, `MUSICBRAINZ_COMPOSERID`, `MUSICBRAINZ_ORIGINALALBUMID` and `MUSICBRAINZ_ORIGINALARTISTID`. Its mappings specify the corresponding spaced ID3 descriptions and Apple MP4 freeform names. Disc IDs describe physical CD layouts. Original IDs preserve merge history, so original artist IDs should not automatically identify the currently credited artist. See [field meanings](https://picard-docs.musicbrainz.org/en/latest/variables/tags_basic.html) and [format mappings](https://picard-docs.musicbrainz.org/en/latest/appendices/tag_mapping.html).

Mp3tag documents native MP4 `plID`, `atID`, `cnID` and `cmID` as iTunes album, artist, catalog and composer IDs. These require reader support for native atoms, separate from OneTagger's custom text fields. See [Mp3tag's MP4 field mapping](https://docs.mp3tag.de/mapping/#tag-fields-exclusive-to-mp4).

## Import constraints

Release Maestro receives known Lofty fields as semantic names and custom fields as raw names. Match those representations in tests. Picard's raw Vorbis `MUSICBRAINZ_TRACKID` identifies a recording, while `MUSICBRAINZ_RELEASETRACKID` identifies a release track. Do not reinterpret an existing Lofty semantic key through a raw-name alias. [Picard's mapping](https://picard-docs.musicbrainz.org/en/latest/appendices/tag_mapping.html) specifies the distinction.

Lofty 0.25.4 emits the documented AcoustID fields as the semantic key `AcoustId`. Normalize it to the same `ACOUSTID_ID` reference as the custom field aliases.

MP4 freeform names include their namespace. Strip only `----:com.apple.iTunes:` before conventional alias matching. An identically named field in another namespace has no established meaning here. ID3 `TXXX:` in documentation describes the storage frame, not necessarily the name emitted by the reader.

Performer references and album-artist references follow separate artist credits. A compilation performer's Discogs ID must not identify its album artist.

Keep unrecognized custom metadata available. Defer fingerprints, generic URL guessing and speculative provider IDs until a concrete source or file fixture establishes their meaning.

## Rescanning existing libraries

The importer stores references in existing JSON columns. No database migration is needed. Normalizer version 5 schedules previously imported files for a new deep read on the next scan.
