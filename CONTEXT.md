# Release Maestro Context

This glossary names the domain concepts agents should use when discussing product behavior, issues, tests, and plans. Keep it focused on domain language, not implementation details.

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
