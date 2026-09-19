# Metadata fixtures

These files contain 120 ms of synthetic silence. Comments, lyrics, artwork, and numeric values are
synthetic test data.

`generate.py` creates audio with FFmpeg and writes tags with Mutagen 1.47.0. It writes the ID3v1 footer
directly. It does not import Lofty, run the metadata engine, or derive expected values from either.
`cases.json` declares the expected fields and custom values.

Regenerate from the repository root with `uv run fixtures/metadata/generate.py`. FFmpeg and uv are
needed only for regeneration. The generated files are committed, so Cargo tests need neither tool nor
network access. Ogg stream serials and encoder versions can change binary output between regenerations.

The binary-level tests in `apps/metadata-engine/tests/metadata.rs` cover:

- MP3, WAV, AIFF, FLAC, Ogg Vorbis, Opus, WavPack, and MP4/M4A.
- ID3v2.3 UTF-16, ID3v2.4 UTF-8, ID3v1 fallback, and primary-tag precedence.
- Every legacy energy, BPM, key, comment, catalog number, and lyrics alias recognized by the engine.
- Fractional and invalid BPM, track totals and overflow, dates, Unicode, and multiline text.
- Arbitrary custom fields, repeated values, MP4 namespaces, and opaque energy strings.
- Embedded artwork, folder artwork, edits, null clears, omitted fields, renames, and rejected writes.
- Tag creation on untagged files and streamed reads containing both valid and truncated audio.

Tests copy inputs into temporary libraries and run the compiled worker over JSONL. They reread writes
in a fresh worker, check unrelated fields and private ID3 payloads, and remove temporary files afterward.
The fixture directory is an explicit input to the Nx test cache.

Lofty 0.22.4 drops additional values in an MP4 atom when converting it to a generic tag.
The engine restores those text values during conversion. `namespaced.m4a` checks both values before
and after edits. The suite also checks MusicBrainz UFID values and preserves the ID3v1 footer byte for
byte when editing a file with an ID3v2 primary tag.

The fixture manifest uses typed fields and rejects unknown keys, invalid flags, and unknown aliases.
