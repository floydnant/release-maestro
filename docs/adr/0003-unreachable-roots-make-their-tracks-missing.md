# An unreachable library root makes its tracks missing, it does not fail the scan

When a configured library root cannot be reached — an unplugged drive, an unmounted share, a deleted
folder — the scan drops that root from the walk and continues over the roots it can reach. Everything
under the unreachable root is then reconciled as missing, exactly like any other file discovery did
not see. Unreachable roots are reported on the scan status (`unavailableRoots`), not as an error.

The reasoning is what `present` means. It is not a claim about whether a file exists somewhere in the
world; it is a claim about whether the app can play it right now. If the drive is unplugged, the
tracks genuinely are not available, and saying so is the honest answer. Missing tracks are retained in
the database, so plugging the drive back in and rescanning restores them.

This includes the case where _no_ configured root is reachable: that scan walks nothing, discovers
nothing, and marks the whole library missing. Refusing to scan there would only trade an accurate
empty library for a stale full one.

## Consequences

- A scan can report a large `missing` count that is not the user's doing. Both scan UIs therefore show
  which roots were unreachable alongside the count — the number is misleading without it.
- Reconciliation is still skipped when a scan is **cancelled**, because a cancelled discovery stopped
  early and genuinely has not seen every file. Unreachable is knowledge; interrupted is not.
- Reconciliation is also still skipped when discovery reported **per-file errors** inside a reachable
  root. That guard is deliberately left in place and is a narrower question than this ADR settles: an
  unreadable subtree is not the same signal as an absent volume, and one flaky read should not flip a
  library to missing.
- **Nothing in the UI blocks on folder availability.** Both folder pickers still call
  `library:validate-roots`, but purely to display status — an unreachable folder is annotated, a
  nested one is marked as skipped, and neither disables saving or rescanning. Blocking would
  contradict this ADR at the worst moment: with a drive unplugged, "Rescan now" is exactly the action
  that reconciles its tracks to missing, so disabling it strands the user with a stale library.
