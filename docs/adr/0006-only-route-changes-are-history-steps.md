# Only route changes are history steps; filter, sort and search replace the entry

The title bar has Back and Forward buttons (MAE-139), and every browse surface declares the URL as
the single source of truth for filter, sort and search — so every sort click, chip removal and
settled search term was a history entry, and getting back to the album you came from took eleven
presses. So `patchQuery` on both browse pages, and the sort on the album detail page, navigate with
`replaceUrl: true`: **a history entry addresses a route**, and the entry you return to carries
whatever query was last in force on it.

The alternative is the browser's own model, where a query string change is a step like any other. It
is the obvious reading of "the URL is the state", and it is what a shipped page did until this
decision. It was rejected because the two buttons make the cost visible: a stack whose entries are
mostly invisible query-param edits gives a Back button that does something different every time it is
pressed, and no way to leave a surface in fewer presses than the user spent tuning it.

## What follows from it

A history entry is now something the app decides rather than something the platform counts, so
`HistoryService` has to recognise one. Two consequences are worth stating, because both are places
where the obvious rule is wrong:

- **A `redirectTo` in the route config is a push, not a replace.** With the default
  `urlUpdateStrategy: 'deferred'` the router writes the address bar once, at the end of the
  navigation, with the URL it redirected _to_ — one `location.go`, one new entry. Recognising a
  redirect by `urlAfterRedirects != url` and treating it as a replace would lose one entry per
  redirect, starting with the app's own `'' → /home`. A guard answering with a `UrlTree` is a
  different thing and does not reach this rule at all: it _cancels_, and only navigations that end
  move the stack.
- **Scroll positions are keyed by an entry's position, not by its navigation id.** A replace keeps
  the position and changes the id, so keying by id would make applying a sort cost the place you
  applied it from — the one thing a replace is supposed to be cheap enough to avoid.

## Consequences

- **Back is no longer an undo for a sort click.** This is a behaviour change to `/tracks` and
  `/albums`, both of which shipped with the browser's model. There is no undo affordance to replace
  it; re-clicking the column is the way back.
- **A sort still returns the surface to the top of its list**, because a new query is a new result
  set and a position measured against the old one means nothing in it. Rewriting the entry is about
  the _stack_, not about the viewport.
- **A shared link still carries the query.** Replacing an entry rewrites the address bar exactly as
  pushing one does, so nothing about copying a URL changes.
- **A new browse surface has to opt in.** Nothing enforces this: a surface that calls
  `router.navigate` for a query change without `replaceUrl` gets the old behaviour back, silently,
  for itself only.
