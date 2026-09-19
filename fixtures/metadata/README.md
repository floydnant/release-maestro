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
- Arbitrary custom fields, repeated values, MP4 namespaces, and opaque energy strings.
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

The fixture manifest uses typed fields and rejects unknown keys, invalid flags, and unknown aliases.

`recording-date.wv` checks full APE recording dates alongside the year-only fixture. WAV and AIFF
edit tests also check their container sizes after tags grow and shrink. Lofty 0.25.2 subtracts tag
growth from the size of a container with a trailing ID3 chunk, and can panic on large growth in
debug builds. The engine streams the file into a temporary file in the same directory, rewrites the
copy, and replaces the original only after the complete write succeeds. Other chunks and trailing
data are retained. This adds I/O for large WAV/AIFF files without buffering the recording in memory.
