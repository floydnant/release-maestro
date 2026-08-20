# Only route changes are history steps; filter, sort and search replace the entry

The title bar has Back and Forward buttons (MAE-139), and every browse surface already declares the
URL as the single source of truth for filter, sort and search — so every sort click, chip removal and
settled search term was a history entry. Back on `/tracks` meant "undo the last sort", and getting
back to the album you came from took eleven presses. So `patchQuery` on both browse pages, and the
sort on the album detail page, navigate with `replaceUrl: true`. **A history entry is a page**, and
the entry you return to carries whatever query was last in force on it.

The alternative is the browser's own model, where a query string change is a step like any other. It
is the obvious reading of "the URL is the state", and it is what a shipped page did until this
decision. It was rejected because the two buttons make the cost visible: a stack whose entries are
mostly invisible query-param edits gives a Back button that does something different every time it is
pressed, and no way to get out of a page in fewer presses than the user spent tuning it.

## Consequences

- **Back is no longer an undo for a sort click.** This is a behaviour change to `/tracks` and
  `/albums`, both of which shipped with the browser's model. There is no undo affordance to replace
  it; re-clicking the column is the way back.
- **A shared link still carries the query.** Replacing an entry rewrites the address bar exactly as
  pushing one does, so nothing about copying a URL changes.
- **Scroll restoration is keyed by entry index rather than by navigation id**, because a replace
  keeps the index and changes the id — see `HistoryService`. Applying a sort must not cost the
  position it was applied at.
- **A new browse surface has to opt in.** Nothing enforces this: a page that calls `router.navigate`
  for a query change without `replaceUrl` gets the old behaviour back, silently, for that surface
  only.
