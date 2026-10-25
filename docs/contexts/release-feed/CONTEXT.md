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
It streams progress to every window as `started`, then `processing` for each exported email (none
when nothing was exported). After export ends, `finishing` keeps the import visibly active while
queued release processing and saving settle. It remains cancellable in this phase. Exactly one
`completed`, `cancelled`, or `error` ends the import. A completed import reports both
`totalImported` (how many the pass covered) and
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
(`EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC`). It associates bought release URLs with fan profiles and photos.
Import groups purchases under the parent album. The album shows every involved fan, and each track
shows only its buyers. A fan who bought the whole album appears on every track. Later notifications
merge attribution into the existing album item. Missing or malformed release pages keep the purchase
and its fan attribution available.

**Fan**:
A Bandcamp listener named in a purchase notification. The profile URL identifies the fan; display
names are not unique. A fan has a display name and may have a profile photo. Overlapping portraits
show involved fans, and a tooltip lists their names.

**Purchase attribution**:
The association between a bought album or track and its fans. Buying an album attributes every
track to that fan. Buying individual tracks attributes only those tracks, while the album's fan
list includes everyone involved. Reimporting the same purchase adds no duplicate fans.

**Parent album**:
The Bandcamp album containing a track. Import reads the track page to resolve its parent album
before choosing the feed item's identity. A genuine standalone track keeps its own release URL.
A missing or malformed track page keeps the original track URL because its album is unknown.
Network failures leave the import checkpoint unchanged so the next pass can retry.
Import schedules parent lookups across each email batch. The shared request gate limits active
Bandcamp requests. Network and server failures get two retries.
Bandcamp page requests share the app-wide cooldown described below. A
processing failure stops the remaining export before the import reports its final error.

**Bandcamp request cooldown**:
A temporary pause after Bandcamp rejects excessive requests. Imports and feed hydration share the
same pause across Bandcamp pages. Imports can wait and retry; the feed reports unavailable data
while retaining the release link and purchase attribution. Visible releases retry after the pause
and keep their position in the feed. Link previews share the same cooldown, so loading them cannot
bypass a pause. Background imports and previews yield while the feed hydrates and slow down after
rate limiting. An import can remain paused until Bandcamp allows requests again; cancellation
remains available. Feed loading runs concurrently and does not wait behind background work.

**Link preview**:
The title and favicon shown for a link from a notification. Previews load after the release appears
and update its links without delaying playback. Repeated links reuse parsed metadata or a release
page already fetched by the app. An unavailable page keeps its original URL as the label.

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
By default, hydration filters releases with no _playable tracks_ out of the displayed feed. Settings
→ Feed can disable this filter. Filtering preserves the item's view and snooze state, so a later
hydration can show it once a track becomes playable. A filtered batch continues loading older
candidates until the visible page is filled or the eligible releases run out.
The app remembers up to 1,000 releases confirmed unplayable for five minutes to avoid fetching them
again on every scroll. Later hydration rechecks them after that interval. Disabling the filter
bypasses the interval. Hydration errors stay visible because their track availability is unknown.
One release's page failure does not prevent other releases from loading. Repeated redirect URLs end
the page lookup immediately. A failed next page preserves the releases already loaded and their
playback. Retrying hydration replaces only the failed release's details, without reopening the feed.
Automatic retries cover the current release and the nearby releases being prefetched.
_Avoid_: scraping — that names the implementation, not the behavior

**Playable track**:
A release track with a nonempty stream URL that the feed player can preview. A track listing alone
does not make a release playable. A release needs only one playable track to pass the feed filter.
_Avoid_: released track, owned track, downloaded track

**Dedupe identifier**:
What makes two notifications about the same release one feed item. It is the release URL, and it is
unique per feed item type in the database. Bandcamp notifications about the same release collapse
across both notification types. Album tracks use the parent album URL. Purchases merge into that
item even when a release announcement supplied its source. When track entries collapse into an
album, the first imported entry keeps its identity, source, viewed state and snooze state. The view
history from every merged entry follows that identity. The same URL with a different feed item
type would not collapse.
Bandcamp release URLs use HTTPS and omit tracking queries, fragments and trailing slashes. Open
windows can still mark a merged track as viewed or snoozed through its original ID until they close.

**Event date**:
When the thing the feed item describes actually happened — for a notification, when the email was
received. Distinct from **ingested at**, which is when the item entered the feed database. The feed
is ordered by event date, so a late import still lands in the right chronological place.
_Avoid_: date, timestamp, created at

**Viewed**:
A successfully hydrated feed item the user has seen (`lastViewedAt`). Passing an error card does not
mark it viewed. Viewing is throttled — re-viewing within a few
minutes does not re-stamp it. An unviewed item is eligible for the feed, subject to the playable-track
filter; a viewed one has left it unless
it is snoozed.

**Snoozed**:
A viewed item marked to come back rather than stay gone. A snoozed item re-enters the feed once its
last view is older than the snooze duration; an unsnoozed viewed item does not return. Settings →
Feed sets the duration in hours, from 1 to 168 with up to two decimals. It defaults to 16, so a
release snoozed today is back by the same time tomorrow instead of just after it. Snooze is
therefore "later", not "hide" — the feed query is "never viewed, or snoozed and viewed long enough
ago".
_Avoid_: dismiss, archive, hide — those read as permanent
