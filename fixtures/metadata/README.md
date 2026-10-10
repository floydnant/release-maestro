# Metadata fixtures

These files contain 120 ms of synthetic silence. Comments, lyrics, artwork, and numeric values are
synthetic test data.

`generate.py` creates audio with FFmpeg and writes tags with Mutagen 1.47.0. It writes the ID3v1 footer
directly. It does not import Lofty, run the metadata engine, or derive expected values from either.
`cases.json` declares the expected fields and custom values.

The generator uses Python for Mutagen's coverage of the audio formats and unusual tag variants in
this suite. Using an independent tag writer prevents Lofty's reader and writer from hiding matching
bugs. A JavaScript generator would need other writers or more handwritten format code for the same
cases. Python and Mutagen are regeneration tools, not application or test-runtime dependencies.

Regenerate from the repository root with `uv run fixtures/metadata/generate.py`. FFmpeg and uv are
needed only for regeneration. The generated files are committed, so Cargo tests need neither tool nor
network access. Ogg stream serials and encoder versions can change binary output between regenerations.

The binary-level tests in `apps/metadata-engine/tests/metadata.rs` cover:

- MP3, WAV, AIFF, FLAC, Ogg Vorbis, Opus, WavPack, and MP4/M4A.
- ID3v2.3 UTF-16, ID3v2.4 UTF-8, ID3v1 fallback, and primary-tag precedence.
- Every legacy energy, BPM, key, comment, catalog number, and lyrics alias recognized by the engine.
- Fractional and invalid BPM, track totals and overflow, dates, Unicode, and multiline text.
- Independent disc/track slash pairs, separate-total precedence, and zero values across all eight formats.
- Arbitrary custom fields, repeated values, MP4 namespaces, and opaque energy strings.
- External references in MP3, FLAC and M4A, including ISRC, barcode, AcoustID, ASIN and service IDs.
- Embedded artwork, folder artwork, edits, null clears, omitted fields, renames, and rejected writes.
- Tag creation on untagged files and streamed reads containing both valid and truncated audio.

Tests copy inputs into temporary libraries and run the compiled worker over JSONL. They reread writes
in a fresh worker, check unrelated fields and private ID3 payloads, and remove temporary files afterward.
The fixture directory is an explicit input to the Nx test cache.

The engine retains native MP4 atoms through the write path. Unchanged atoms keep all data variants,
including opaque binary and numeric values. `namespaced.m4a` and `mixed-data.m4a` check repeated and
mixed values through edits. The suite also checks MusicBrainz UFID values and preserves the secondary
ID3v1 footer byte for byte. Native Vorbis, APE and RIFF tags are retained separately because generic
conversion discards their custom fields.

`editable-mixed.m4a`, `editable-alias.m4a`, and `editable-aliases.m4a` check that text edits
retain opaque siblings across alias canonicalization and that clears remove the entire atom.
`repeated-ape.wv` checks NUL-separated custom values; `riff-aliases.wav` checks that cleared
secondary RIFF aliases do not reappear.
`multiple-artists.wv` checks NUL-separated artist, album artist, genre, title, and album values through
reads, unrelated edits, and replacements. It also checks clears for the four nullable fields.
`ratings.flac`, `ratings.ogg`, and `ratings.opus` check that unrelated edits retain repeated numeric
ratings and listener-specific ratings.
`id3-ratings.mp3`, `id3-ratings.wav`, and `id3-ratings.aiff` check native ID3 rating values and play
counters through unrelated edits. They include an unknown rating, a non-star-aligned rating, and a
counter larger than 32 bits. Native rating frames are retained before generic conversion and restored
on save. `secondary-publisher.mp3` checks that clearing the primary label does not expose a secondary
APE Publisher; `publisher-only.mp3` checks the fallback when there is no primary tag.
`custom-frame-names.mp3` keeps custom text and URL fields named like standard ID3 frames independent
through edits. The native snapshot also keeps those fields out of generic conversion; explicit edits
still remove matching legacy aliases such as a custom `TKEY`.
`ordered-key-aliases.mp3` checks that four-character custom aliases retain their legacy precedence
over longer custom descriptions after repeated edits and fresh-worker reads.

The fixture manifest uses typed fields and rejects unknown keys, invalid flags, and unknown aliases.

`recording-date.wv` checks full APE recording dates alongside the year-only fixture. WAV and AIFF
edit tests check their container sizes after tags grow and shrink. On Unix, they also check that
edits preserve the original inode. Lofty 0.25.4 fixes the trailing ID3 chunk size calculation, so
WAV and AIFF use the same regular save path as MP3. The engine no longer replaces these files with
a temporary copy, preserving their inode metadata, including ACLs and extended attributes.
