# Context Map

Release Maestro has two coequal product pillars that share infrastructure but not vocabulary. Read the
glossary for the pillar you are working in.

Contexts here are **product** boundaries, not Nx projects. Both of them cut across
`maestro-electron`, `maestro-renderer`, and `maestro-core`, so their glossaries live under
`docs/contexts/` rather than inside any one project directory. Do not expect a project to map to a
context.

## Contexts

- [Music library](./docs/contexts/music-library/CONTEXT.md) — scans the user's local music folders
  into the song database.
  Backend `apps/maestro-electron/src/app/services/library`, UI `apps/maestro-renderer` (`/import`,
  settings → library), contract `libs/maestro-core/src/schemas/library.schema.ts`, tag reading
  `apps/metadata-engine`.
- [Release feed](./docs/contexts/release-feed/CONTEXT.md) — imports Bandcamp notifications and
  hydrates them into a browsable release feed.
  Backend `apps/maestro-electron/src/app/services/{email,feed}`, UI `apps/maestro-renderer` (feed
  pages, settings → Apple Mail), contract `libs/maestro-core/src/schemas/{email,feed}.schema.ts`,
  export automation `apple-scripts/`.

## Relationships

- **Shared infrastructure, separate models.** Both contexts live in the same SQLite database, but only
  the music library reads audio tags through the metadata-engine sidecar. They do not share tables:
  `feed_*` tables belong to the release feed, the song/scan tables to the library.
  `make db-truncate-library` deliberately preserves `feed_*` for this reason.
- **No coupling yet.** Nothing currently matches a library song to a feed release. If that link is
  built, it needs its own vocabulary and probably its own ADR — do not assume either context's terms
  carry over.
- **"Release" belongs to the feed; the library says "album".** Both contexts model the same
  real-world thing — a group of tracks issued together — differently, and share no table. The
  library's is _inferred_ from the tags on files the user owns (`albums`); the feed's is _announced_
  by Bandcamp and not necessarily owned (`feed_items`).

    The library used to say "release" in its copy while saying "album" in code, which left the word
    meaning two things and needing to be qualified whenever both contexts were in view. It now says
    **album** in both registers, so the word is unambiguous by construction rather than by discipline.
    Never pass one where the other is expected.

## Decisions

Architectural decisions live in [`docs/adr/`](./docs/adr/). Because contexts cross project
boundaries, ADRs are kept in one place at the root rather than per project.
