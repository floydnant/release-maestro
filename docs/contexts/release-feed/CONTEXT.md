# Release Feed

This glossary names the domain concepts agents should use when discussing product behavior, issues, tests, and plans. Keep it focused on domain language, not implementation details.

Scoped to the **release feed** context — Bandcamp releases the user is tracking. For the user's local
music collection see [music library](../music-library/CONTEXT.md); the two are coequal and do not
share vocabulary. See [CONTEXT-MAP.md](../../../CONTEXT-MAP.md).

This context is not one Nx project. It spans the email/feed backend services in `maestro-electron`,
the feed pages in `maestro-renderer`, and its schemas in `maestro-core` — which is why the glossary
lives here rather than inside any one project.

## Terms

### Release Maestro

A desktop app for tracking and discovering music releases from Bandcamp.

### Release

A Bandcamp music release that can appear in the app's feed. A release may include cover art, artist information, track listings, metadata, and previewable audio.

### Release feed

The browsable collection of imported and enriched releases shown to the user.

### Feed item

One release entry in the release feed.

### Bandcamp notification

An email notification from Bandcamp that announces and points to a release.

### Feed Hydration

The process of enriching imported release information by reading the linked Bandcamp page and filling in fuller metadata.

### Feed source

An origin from which release information enters the app, such as imported Bandcamp notifications.

## Avoided Synonyms

- Prefer "release feed" over "timeline" or "stream" unless the UI explicitly uses those words.
- Prefer "Bandcamp notification" over "email alert" when referring to the imported source material.
- Prefer "feed hydration" over "scraping" when naming the product behavior; use "scraping" only for implementation details.
