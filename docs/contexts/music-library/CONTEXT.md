# Music Library

The user's local music collection, scanned from folders on disk into the song database. Distinct from
the [release feed](../release-feed/CONTEXT.md), which is about Bandcamp releases the user does not
necessarily own.

This context is not one Nx project. It spans the library services in `maestro-electron`, the import
and library-settings pages in `maestro-renderer`, the scan contract in `maestro-core`, and tag reading
in `metadata-engine` — which is why the glossary lives here rather than inside any one project.

## Language

### Folders and setup

**Library folder**:
One folder the user nominated as a top of their music collection. Stored canonicalized (`realpath`),
so two selections of the same directory through different symlinks collapse to one.
_Avoid_: root, library root, library path, directory, source

When naming this product concept, say **folder** in product UI, identifiers, and docs. "Root" reads
as scanner-implementer jargon and the app never shows the word to users. `path` and `directory`
remain correct for literal filesystem representations and low-level filesystem operations; do not
rename those merely to satisfy the product-language rule.

**Configured folders** / **scanned folders**:
Two genuinely different lists, so qualify which one you mean. _Configured_ is what the user picked and
what `library.folders` persists. _Scanned_ is what a given scan actually walked, after
canonicalization, dedup, dropping nested folders, and dropping unreachable ones — `status.scannedFolders`.
A user with three configured folders can legitimately see a scan report one.

**Nested folder**:
A library folder that lives inside another one in the same set. Detected and dropped before scanning,
since scanning both is redundant.

**Library onboarding**:
The first-run flow at `/import` that gates the app until the user either configures folders or skips.
Skipping is remembered (`library.onboardingSkipped`) and replaces the gate with a sidebar nudge.
_Avoid_: setup wizard, first-run

### Scanning

**Scan**:
One pass over the library folders that brings the song database in line with what is on disk. Exactly
one runs at a time, app-wide.

**Trigger**:
Why a scan started — `startup`, `manual`, `onboarding`, or `debug`. Not cosmetic: the UI paces a
`startup` scan differently from one the user asked for (see ADR 0002).

**Discovery**:
The first scan phase. Walks the library folders and records a fingerprint per file, tallying each as
new, changed, or unchanged. Called _prescan_ at the metadata-engine boundary.
_Avoid_: crawl, walk, indexing

**Deep read**:
The second scan phase. Reads full tags and cover art for files seen by the current discovery that
still need metadata. A changed fingerprint or metadata revision queues a read, including work left
unfinished by an earlier scan.
_Avoid_: full scan, tag scan

**Metadata revision**:
The version of the extractor and normalizer rules that last read a song. A changed revision means
unchanged audio may contain information the app could not previously extract or normalize.

**Metadata refresh**:
A deep read of unchanged audio after the metadata revision changes. It updates the song's metadata
while preserving its identity and Added date. Failed reads remain pending for the next scan that sees
the file. The scan reports refreshes separately from files changed on disk.

**Unused catalog entity**:
An album, artist, genre, record label, or raw name with no remaining catalog references. Completed
scans remove these entities after metadata updates. Missing songs retain their references, and
user-confirmed raw-name resolutions remain even without songs.

**Reconciliation**:
Matching moved songs to their existing identity, then marking songs absent (`present = false`) when
discovery did not see them. Runs after deep read. Skipped when the scan was cancelled or discovery
reported errors — see ADR 0003. Read failures also defer move matching until a complete retry.
_Avoid_: pruning, cleanup, deletion

**Moved song**:
A previously imported file discovered at a different path, including a renamed file. A unique match
keeps the original song ID, Added date, external references, and dismissed normalization issues.
It is reported as changed rather than new when first discovered at the new path. Unchanged rescans
can also repair a unique missing/present pair left by an earlier interrupted or pre-upgrade scan.

**Content hash**:
A SHA-256 digest of all file bytes, read by the metadata engine during deep read. It identifies
byte-identical files independently of their paths and filesystem timestamps. It differs from the
file fingerprint, which includes the path and decides whether another deep read is needed.
Existing reachable songs receive a content hash on their next scan. For older songs already missing,
move matching requires a unique full-metadata-hash and size match with identifying title and artist
or album tags. That fallback is an inference, not proof of equal audio bytes. Untagged older missing
songs need a scan at their original location before content matching is possible.

Move matching requires exactly one unseen song and one seen song with the matching identity. The
destination must have first appeared after the original was last seen, and the original path must
no longer exist. Known copies, ambiguous matches, changed bytes with known hashes, and inconclusive
filesystem errors retain separate rows. Moving and editing tags together is not a byte-identical move.

**Missing**:
A song in the database whose file was not seen by the last complete discovery. `present` means "the
app can reach this file now", not "this file exists somewhere" — so tracks on an unplugged drive are
missing. Missing songs are retained, not deleted, and come back on the next scan that reaches them.

**Unavailable folder**:
A configured folder the scan could not reach. Dropped from the walk; its tracks go missing. Reported
on the scan status (`unavailableFolders`) so the UI can explain the count — not an error (ADR 0003).

**Terminal result**:
The one-shot summary produced when a scan ends, carrying the outcome (`completed`, `cancelled`,
`failed`) and the final tallies. Every non-idle scan produces exactly one.

**Failure stage**:
Whether a per-file failure happened in `discovery` or `read`. Kept distinct because the two mean
different things — an unreadable folder is not a broken tag.

**Normalization issue**:
A suspicious or malformed tag value found on a song during ingest (wrong-looking field, embedded
junk), recorded per song and fingerprinted so it can be dismissed once and stay dismissed. A scan
reports the number of _distinct songs_ with open issues, not the number of issues.
_Avoid_: tag error, validation error — those mean read failures

**Album preview**:
A deduped album cover streamed to the renderer during a scan for the import mosaic. Keyed by cover
path, which works as a dedup key because the cover cache is content-addressed.

### Catalog

**Song** (code) / **track** (user-facing copy):
One audio file in the collection. The concept is identical in both registers; only the word changes.
Say **song** in code, identifiers, schemas, tables and docs — `songs`, `songId`, `SongTable`,
`SongQuery`. Say **track** in anything a user reads — "1,204 tracks", a "Tracks" tab, "no tracks
match".

"Track" is ambiguous — a track on a record, a track in a DAW, a position in a tracklist — while
"song" universally names one thing. So code takes the unambiguous word and the UI takes the one users
actually say. The same register split as _record label_ and as _discovery_, which is _prescan_ at the
metadata-engine boundary.
_Avoid_: `track` in identifiers except the tagged `trackNumber` and `trackTotal`; file, item, entry as synonyms for song

**Track number** and **track total** are deliberate exceptions: `trackNumber` names a tagged position,
and a file's `trackTotal` names its tagged total for one disc; an album's total is derived. Counts of library rows use `songCount`.
Do not rename the tag fields to `songNumber` or `songTotal`.

The track number is **always the tag and never a position in a list**. A file with no track number is `null`, and
stays `null`.

**External reference**:
An identifier or link from an audio tag that refers to a recording, album, artist, or record label
in an external catalog. A song retains every recognized reference found on its file. Albums and record labels
also retain references relevant to their entity type. Artist references come from the song
and album credits that resolve to that artist.
_Avoid_: fingerprint, external match, verified identity

**Disc number**:
The tagged disc position of a song within an album. Album track lists order by disc number, then
track number. A missing disc number stays `null`; the app does not infer one from file order.

**Disc total** / **track total**:
A file's tagged disc count and track count on one disc. Zero values mean unknown. An album's track
total is derived from these tags. A single disc uses the largest tagged total; multiple discs sum
known per-disc totals only when every represented disc has one. Unassigned songs make that sum
unknown, since they may belong to a numbered disc. Tags do not invent totals for absent discs.

**Disc section**:
A contiguous group of tracks from one tagged disc in an album track list. Multidisc evidence is a
numbered disc beyond one or a tagged disc total beyond one. Untagged tracks remain an unknown group;
untagged tracks mixed with disc one alone do not establish a second disc.

**Album**:
A group of songs issued together. **One word in code and in copy alike** — `albums`, `albumId`,
`albumArtists`, an "Albums" tab, "12 albums". It is what music players call this, and it is what
users looking for it will say.

There was a register split here — code _album_, copy _release_ — and it was dropped. A "Releases" tab
reads like an inbox of things arriving rather than a collection of records already owned, which is
precisely what the release feed is and this is not. Keeping the word for the feed alone is worth more
than the split was.

The cost, stated so it is not rediscovered as a bug: an album is not always an album. It may equally
be an EP, a single or a compilation, and "release" covered those where "album" strains. The library
does not distinguish them yet; when a `releaseType` attribute lands, the copy can say _EP_ or _single_
where it knows, which is a better answer than a vaguer word everywhere.

Album fields come from the songs' normalized tags. The identity key groups songs by album title,
album artist, record label, catalog number, date, and the explicit year tag. The displayed year falls
back to the leading year in the date. Different identity values mean different albums, even when
only one song was retagged. A rescan moves that song alone, keeps its song ID, and deletes its old
album only after the last member leaves. Missing songs remain members. Links to deleted albums
resolve to no album; the scanner does not guess that similarly named albums should merge.

An album retains the union of its members' resolved album-artist credits, including missing members.
Whitespace-equivalent raw aliases can carry different confirmed resolutions; each resolved artist
is linked once, in stable credit order. Rereading another member does not overwrite those links.

Cover art is per song. An album prefers artwork from reachable members, choosing the most common
cover and breaking ties by its content-addressed path. If no reachable member has artwork, it uses
retained artwork from missing members by the same rule. The choice is independent of read order.
Artwork differences are valid and produce no normalization issue. An album's date added is
recomputed when a song joins or leaves it.

Track browsing displays, sorts, and filters the song's record label. Its linked record-label entity
is resolved from that same text, including for songs without an album. Album browsing uses the
album's record label. Neither view replaces the stored song tags with a majority or last-read value.

**Release** now belongs to the [release feed](../release-feed/CONTEXT.md) and to nothing here. The two
were the same real-world concept modelled twice — the library's _inferred_ from tags on files the user
owns, the feed's _announced_ by Bandcamp and not necessarily owned — and the word no longer has to be
qualified to tell them apart. See [CONTEXT-MAP](../../../CONTEXT-MAP.md).
_Avoid_: release, record, LP, disc

**Artist credit**:
How one song names the artists behind it, in the tag's own phrasing. An ordered list of segments —
each an artist, the name they are credited as here, and the phrase that joins it to the next
(`" & "`, `" feat. "`, `" vs. "`). Concatenating the segments in order reproduces the credit exactly
as tagged, which is why the UI can show `Burial & Four Tet` verbatim while still linking each name to
its own artist.

A credit belongs to the **raw name**, not to the song: `artist_raw_names` is keyed by the raw tag
string, so resolving one string resolves it for every song ever tagged that way. `song_artists` is a
materialized projection of that resolution — anything that edits a raw-name resolution must
re-project `song_artists` for every song carrying that raw name. A rescan is not required.
_Avoid_: artist string, artist field, credit line

Today every credit has exactly one segment spanning the whole string, because ingest does not split
raw names on its own — splitting is a user-confirmed act (`confirmedByUser`). So `Burial & Four Tet`
is currently one artist entity. Treat the single segment as the degenerate case, not as the model.

**Appears on**:
The albums an artist has songs on without being an album artist of them — compilations, VA
collections, guest features, DJ mixes. Defined by exclusion, so it is strictly disjoint from that
artist's own albums; the two together account for every album the artist touches. An artist's own
album never shows up here.
_Avoid_: featured on, guest appearances, other releases

**Years active**:
The earliest and latest non-null year among songs credited to an artist through `song_artists` and
songs on albums credited to the artist through `album_artists`. Track and album counts keep their
separate credit rules. A range does not claim the artist worked in every intervening year. With no
tagged year, the UI says "Years unknown".

A record label's years active are the earliest and latest non-null year among its albums and songs
carrying its record-label tag.

**Released on record labels**:
The distinct record labels of albums credited to an artist through `album_artists`. An album where
the artist only has a song credit belongs under "Appears on" and does not add its record label here.

**Record label**:
The company that released a record: Warp, Ninja Tune, Hyperdub. Always **two words**, never "label"
on its own. Bare "label" reads as a tag or a UI caption without context, which is why the concept was
renamed — `record_labels` as a table, `recordLabelId` on an album, `recordLabelText` and
`rawRecordLabel` on a song.
_Avoid_: label, imprint, publisher

The audio tag itself is still called `label`, because that is its name in the file format and in the
metadata-engine contract (`metadata.label`, `ItemKey::Label`). Read it as `label` at that boundary and
call it a **record label** everywhere upstream — the same split as _discovery_, which is _prescan_ at
the metadata-engine boundary.

Nothing in the triage or Linear sense of "label" belongs to this context.

**Record label membership**:
An album belongs to a record label through `albums.recordLabelId`, never through `recordLabelText`.
A song belongs through its own `recordLabelText`, matched to the record label's name. This includes
songs without albums and songs whose tags disagree with their album. Song counts and song years
use that same membership. The record label's artists are the album artists of its albums plus the
artists credited on its songs, each counted once, including through missing songs.
An album artist with no song credit there opens their albums on that record label rather than
its tracks.
_Avoid_: label roster, signed artists

**Genre text** (`genreText`):
The normalized whole genre tag displayed on a song. Ingest currently does not split compound tags:
`Techno; Ambient` remains one genre entity with that whole name. Resolving or splitting genre text is
separate from browsing it. `genre_raw_names` stores the resolution of a whole tag;
`song_genres` projects that resolution onto each song carrying the tag.
_Avoid_: genre list, split genres

**Genre membership** (`song_genres`):
A song's link to a resolved genre entity. Browse filters and related track, artist, album, and record
label counts use these entity IDs, not substring matches against genre text. A retained genre entity
can have zero linked songs.
_Avoid_: genre substring, genre tag match

**Related to a genre**:
Artists credited on songs with that genre membership, albums containing those songs, and record labels
resolved from those songs' record-label tags. Each entity is counted once, including relationships
through missing songs and record labels on songs without an album.
_Avoid_: similar genres, recommendations, album-artist membership

## Browsing

Artist, album, genre, and record label links on tracks and album headers open the corresponding
detail page using resolved entity IDs. A record label name without an entity ID remains plain text.
Browse filters and missing-track badges explicitly narrow a track list.

The architecture is [ADR 0004](../../adr/0004-browse-queries-are-windowed-and-selections-carry-a-query.md),
and the terms it defines are not repeated here. One word is worth pinning because the
obvious synonym is wrong:

**Window**:
The slice of an ordering a surface currently holds — an offset and a limit, plus a fixed
overscan margin. Never the result set.
_Avoid_: **page**. Nothing here is paginated: the scrollbar is continuous, the window
slides, and there is no page number for anything to be on.
