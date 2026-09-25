# Development instance state is user-scoped and dependency-free

Parallel worktrees coordinate ports, app-data paths, processes, and verification workflows through a
locked registry under the user's home directory. Worktree manifests are only local identity caches,
and the manager uses the Node.js standard library so allocation and session hooks work before package
installation. This trades a small amount of custom locking and recovery code for one authority shared
by every worktree without a service or database.
