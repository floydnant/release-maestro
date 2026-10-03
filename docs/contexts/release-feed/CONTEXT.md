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
today. Multiple mailboxes are a noted future possibility, but are not represented in the settings.
Each mailbox has its own _import checkpoint_. Switching to a mailbox without a checkpoint starts
with a full export. Returning to a previously imported mailbox reuses its checkpoint.

**Export**:
The AppleScript pass that pulls messages out of Apple Mail (`apple-scripts/export-emails.applescript`).
It leaves the mail app and produces raw emails. Everything downstream is import. Given an _import
checkpoint_, it exports only the messages received from shortly before it, and Mail does the filtering.
The export opens Mail when it is closed. Then it quits Mail again when it finishes, fails, or is
cancelled. When Mail was already open, the export leaves it open.
Each message is attempted up to three times. A message that still cannot be exported or read is
skipped for this pass, so the remaining messages can be imported.
_Avoid_: sync, fetch, download

**Import**:
One pass that turns exported emails into feed items. Only one runs at a time (`EmailImportService`).
It streams progress to every window as `started`, then `processing` for each email (none when nothing
was exported), then exactly one `completed`, `cancelled`, or `error`, and reports both `totalImported` (how many the pass covered) and
`newlyImported` (how many were not already in the feed) — a user re-running an import may
legitimately see a nonzero total and a zero new count, because it re-reads the overlap before its
_import checkpoint_. Each update carries its trigger. The title bar shows every import, but paces and
summarizes only _auto imports_. A `manual` import starts from the Apple Mail settings page, which shows
the running or last import of the session whatever its trigger. A completed import that adds releases
reloads an open empty or caught-up feed. A feed already displaying releases keeps its current items
and playback. On macOS, closing the last window keeps the import coordinator and its dependencies
alive. Quitting the app aborts and drains the import before closing the database.
An import with skipped emails still completes and keeps its successfully imported releases. Its
summary reports how many emails will be retried, and its checkpoint stays unchanged so the next
import includes them again.
_Avoid_: scan (that is a music-library word), refresh

**Auto import**:
An _import_ the app starts on its own, on app start and on window focus, when the last import of any
trigger started more than an hour ago and a _mailbox_ is configured on macOS. It reports in the title
bar like the startup library scan, except on the import route. A completed or failed one ends in a
summary that hides after four seconds; a cancelled one ends in nothing. A manual request while one
runs takes it over, and from then on it is shown live, without the summary. If the _mailbox_ changed since it started,
the manual request cancels it and starts a new import instead.
_Avoid_: background sync, polling

**Import checkpoint**:
How far a mailbox has been imported: the newest date received that a completed import covered, kept
per vendor and mailbox (`feed_email_import_checkpoints`). The next import exports only mail received
from a day before it, so a message that synced in late is still read. A cancelled or failed import
does not advance it, and neither does an import where an exported email could not be read or parsed.
It never moves backwards or past the start of the import. Without one, the export reads the whole
mailbox.
A message moved into the mailbox long after it was received is older than the checkpoint and is not
picked up.
_Avoid_: watermark, cursor, last sync

### Notifications and sources

**Bandcamp notification**:
An email from Bandcamp announcing music. The raw material of the feed.
_Avoid_: email alert, notification email

**New release notification**:
The notification announcing one release from an artist the user follows
(`EMAIL.BANDCAMP_NEW_RELEASE`). Carries a single release URL, a release type, and the links from the
mail body.

**Fans-bought-music notification**:
The Bandcamp notification about releases bought by fans the user follows
(`EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC`). It carries a list of release URLs, so import creates one feed
item per distinct URL. Each keeps the notification's event date and read state. These releases show
a "Bought by fans you follow" chip in the feed, including when hydration fails.

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

The word is this context's alone. The music library models the same real-world thing from the user's
own files and calls it an **album**, in code and copy alike — so "release" needs no qualifier to say
which of the two is meant. A release is _announced_ and not necessarily owned; an album is _inferred_
from a file on disk. Neither converts to the other. See
[CONTEXT-MAP](../../../CONTEXT-MAP.md).

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
unique per feed item type in the database. Bandcamp notifications about the same release collapse
across both notification types. The first imported notification supplies the retained source. The
same URL with a different feed item type would not collapse.

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
