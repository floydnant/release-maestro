# Release Feed

Bandcamp releases the user is tracking, imported from email notifications and hydrated into a
browsable feed. Distinct from the [music library](../music-library/CONTEXT.md), which is about music
the user already owns on disk. The two are coequal and do not share vocabulary — see
[CONTEXT-MAP.md](../../../CONTEXT-MAP.md).

This context is not one Nx project. It spans the email and feed services in `maestro-electron`, the
feed pages in `maestro-renderer`, its schemas in `maestro-core`, and the export automation in
`apple-scripts/` — which is why the glossary lives here rather than inside any one project.

## Language

### Getting mail out of the mail app

**Email vendor**:
The mail application notifications are read from. `APPLE_MAIL` is the only one today, and the setting
that configures it is per-vendor (`emailPluginConfig.APPLE_MAIL`), so treat the vendor as a
dimension rather than an assumption.
_Avoid_: mail provider, email client, plugin

**Mailbox**:
The one named Apple Mail mailbox the export reads from (`mailboxName`). Exactly one is configured
today; the schema anticipates a list.

**Export**:
The AppleScript pass that pulls messages out of Apple Mail (`apple-scripts/export-emails.applescript`).
It leaves the mail app and produces raw emails. Everything downstream is import.
_Avoid_: sync, fetch, download

**Import**:
One pass that turns exported emails into feed items. It streams progress to the renderer as
`processing`, then exactly one `completed` or `error`, and reports both `totalImported` (how many the
pass covered) and `newlyImported` (how many were not already in the feed) — a user re-running an
import legitimately sees a large total and a zero new count.
_Avoid_: scan (that is a music-library word), refresh

### Notifications and sources

**Bandcamp notification**:
An email from Bandcamp announcing music. The raw material of the feed.
_Avoid_: email alert, notification email

**New release notification**:
The notification announcing one release from an artist the user follows
(`EMAIL.BANDCAMP_NEW_RELEASE`). Carries a single release URL, a release type, and the links from the
mail body.

**Fans-bought-music notification**:
The other Bandcamp notification shape (`EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC`). It announces several
releases at once and carries a list of URLs rather than one release, so it fans out into multiple
feed items.

**Feed source item**:
A parsed notification, before it becomes a feed item. This is the boundary type: one source item can
produce several feed items, and a feed item records which source item it came from.

**Feed source**:
An origin from which release information enters the app. Bandcamp notifications are the only one
today; a pasted-link stash is stubbed but unbuilt, and has no vocabulary yet.

**Tralbum**:
Bandcamp's own word for "an album or a track" — the thing a Bandcamp page describes when you don't
yet know which it is. Use it only at the Bandcamp boundary, where it names their concept
(`tralbumUrl`, `BANDCAMP.TRALBUM`). In product language and UI copy the word is **release**.

### The feed

**Release**:
A Bandcamp music release that can appear in the feed. May carry cover art, artist and band
information, a track listing, an embeddable player, and free-text "about" copy.

**Release feed**:
The browsable collection of imported and hydrated releases shown to the user.

**Feed item**:
One entry in the release feed. Its identity is the release, not the email — see _dedupe identifier_.

**Hydration**:
Enriching an imported release by reading the linked Bandcamp page and filling in fuller metadata. A
feed item can be present but unhydrated, and hydration can fail on its own without losing the item.
_Avoid_: scraping — that names the implementation, not the behavior

**Dedupe identifier**:
What makes two notifications about the same release one feed item. It is the release URL, and it is
unique per feed item type in the database. Two Bandcamp emails about the same album collapse; the
same URL arriving from a different source type would not.

**Event date**:
When the thing the feed item describes actually happened — for a notification, when the email was
received. Distinct from **ingested at**, which is when the item entered the feed database. The feed
is ordered by event date, so a late import still lands in the right chronological place.
_Avoid_: date, timestamp, created at

**Viewed**:
A feed item the user has seen (`lastViewedAt`). Viewing is throttled — re-viewing within a few
minutes does not re-stamp it. An unviewed item is always in the feed; a viewed one has left it unless
it is snoozed.

**Snoozed**:
A viewed item marked to come back rather than stay gone. A snoozed item re-enters the feed once its
last view is old enough; an unsnoozed viewed item does not return. Snooze is therefore "later", not
"hide" — the feed query is "never viewed, or snoozed and viewed long enough ago".
_Avoid_: dismiss, archive, hide — those read as permanent
