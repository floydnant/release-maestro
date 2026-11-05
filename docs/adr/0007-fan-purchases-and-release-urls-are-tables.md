# Fan purchases and release URLs are tables, not feed item JSON

Fan-purchase notifications attribute releases and tracks to fans. We store fans, their purchases and
the release URLs each feed item answers to in their own tables (`feed_fans`, `feed_purchases`,
`feed_release_urls`) rather than inside `feed_items.data`. The feed is meant to be filtered and
curated by who bought what. With JSON, every such question, and the import's own deduplication,
had to load and parse every feed item in TypeScript; with tables they are indexed joins.

Purchases reference the bought URL, not a feed item. A purchase reaches its item through
`feed_release_urls`, so merging tracks into their album repoints URL rows and never moves purchases.
Each URL belongs to one item. The migration folds items that already share a URL into the oldest of
them, as an import would merge them. Only unreleased builds could store such items, so the schema does
not loosen this rule for them.

## Considered Options

- **Keep JSON and add a lookup table for filtering.** Cheaper, but stores the same facts twice and
  leaves deduplication scanning every row.
- **Store every notification and derive the feed from it.** Gives a purchase history and lets
  grouping rules be re-run without reimporting, at the cost of a rebuildable projection. Nothing needs
  a history yet; a purchase records only when it was first reported.

## Consequences

- Tracks are not stored. Track lists still come from the release page on each load, and only bought
  or announced track URLs get rows.
- `FeedBackendRepository` is the only place that splits purchases into tables and joins them back;
  the rest of the app reads and writes `FeedItemWithPurchases`.
