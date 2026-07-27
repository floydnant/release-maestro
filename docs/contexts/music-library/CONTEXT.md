# Music Library

The user's local music collection, scanned from folders on disk into the song database. Distinct from
the [release feed](../release-feed/CONTEXT.md), which is about Bandcamp releases the user does not
necessarily own.

This context is not one Nx project. It spans the library services in `maestro-electron`, the import
and library-settings pages in `maestro-renderer`, the scan contract in `maestro-core`, and tag reading
in `metadata-engine` — which is why the glossary lives here rather than inside any one project.

## Language

### Roots and setup

**Library root**:
One folder the user nominated as a top of their music collection. Stored canonicalized (`realpath`),
so two selections of the same directory through different symlinks collapse to one root.
_Avoid_: library path, directory, source

**Nested root**:
A root that lives inside another root in the same set. Detected and dropped before scanning, since
scanning both is redundant.

**Library onboarding**:
The first-run flow at `/import` that gates the app until the user either configures roots or skips.
Skipping is remembered (`library.onboardingSkipped`) and replaces the gate with a sidebar nudge.
_Avoid_: setup wizard, first-run

### Scanning

**Scan**:
One pass over the library roots that brings the song database in line with what is on disk. Exactly
one runs at a time, app-wide.

**Trigger**:
Why a scan started — `startup`, `manual`, `onboarding`, or `debug`. Not cosmetic: the UI paces a
`startup` scan differently from one the user asked for (see ADR 0002).

**Discovery**:
The first scan phase. Walks the roots and records a fingerprint per file, tallying each as new,
changed, or unchanged. Called _prescan_ at the metadata-engine boundary.
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

**Unavailable root**:
A configured root the scan could not reach. Dropped from the walk; its tracks go missing. Reported on
the scan status so the UI can explain the count — not an error (ADR 0003). Distinct from a root that
fails _picker_ validation, which is refused at save time.

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
