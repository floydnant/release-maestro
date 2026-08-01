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
The second scan phase. Reads full tags and cover art for the files that need it. Its queue comes from
a fingerprint mismatch in the database, not from the discovery tallies — which is what makes an
interrupted scan resumable.
_Avoid_: full scan, tag scan

**Reconciliation**:
Marking songs absent (`present = false`) when discovery did not see them. Skipped when the scan was
cancelled, since a cancelled discovery has not seen every file — see ADR 0003.
_Avoid_: pruning, cleanup, deletion

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
_Avoid_: `track` in any identifier; file, item, entry as synonyms for song

**Track number** is the deliberate exception and stays `trackNumber` in code: it names a position on a
release, not a song. Do not "correct" it to `songNumber`.

**Album** (code) / **release** (user-facing copy):
A group of songs issued together. Code says **album** — `albums`, `albumId`, `albumArtists`; copy says
**release** — a "Releases" tab, "12 releases". The register split exists because a release is not
always an album: it may equally be an EP, a single or a compilation. The library does not distinguish
these yet; a `releaseType` attribute is expected later. Until it exists, do not call a release an
album in copy.
_Avoid_: record, LP, disc

The release feed has a **release** too, and it is the same real-world concept modelled twice — see
[CONTEXT-MAP](../../../CONTEXT-MAP.md). The library's is _inferred_ from tags on files the user owns;
the feed's is _announced_ by Bandcamp and not necessarily owned. Neither model converts to the other,
so never pass one where the other is expected.

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
The albums an artist has songs on without being an album artist of them — compilations, VA releases,
guest features, DJ mixes. Defined by exclusion, so it is strictly disjoint from that artist's own
releases; the two together account for every album the artist touches. An artist's own album never
shows up here.
_Avoid_: featured on, guest appearances, other releases

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

Artist and genre carry no ambiguity as entities and are not listed here.
