# Development instances

Each Git worktree has one development instance. The instance manager gives it a stable endpoint
bundle with a renderer port, Electron CDP port, and Node inspector port. Slot zero uses 4200, 9222,
and 5858. Later slots offset all three ports together. If any port in a slot is busy, the manager
tries the next complete slot. Debug endpoints listen on loopback.

The manager stores a manifest at `.release-maestro-instance.json` in the worktree and a locked,
user-scoped registry under the home directory. The manifest holds a generated worktree ID, checkout
identity, and a copy of its bundle. The registry owns the allocation. A branch change keeps the ID.
A new worktree at an old path gets a new ID. The manager uses only the Node standard library, so allocation,
status, recovery, and hooks work before `make install`.

## Commands

Run these from the worktree whose instance you want to manage.

| Command                       | Action                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `make dev`                    | Build the host sidecar and start the renderer and Electron under one supervisor.           |
| `make dev-allocate`           | Reserve a stable bundle without starting the app. Reuses an existing allocation.           |
| `make dev-status`             | Show this worktree's bundle, slot, holders, claims, age, and health. `JSON=1` prints JSON. |
| `make dev-list`               | Show all registered development and verification instances. `JSON=1` prints JSON.          |
| `make dev-release`            | Release an idle allocation now. Refuses while holders are live.                            |
| `make dev-reallocate`         | Give an idle instance a new bundle after a port conflict or a manual override.             |
| `make dev-stop`               | Stop validated dev processes and orphaned E2E processes owned by this worktree.            |
| `make dev-recover`            | Reset a blocked registry after stopping live processes and inspecting quarantined copies.  |
| `make dev-log`                | Read lifecycle events. `FOLLOW=1` follows; `JSON=1` prints JSON Lines.                     |
| `make dev-instance-self-test` | Start two temporary worktrees and verify independent stacks and shutdown.                  |

Set all three ports together for a manual bundle:

```bash
RELEASE_MAESTRO_RENDERER_PORT=4300 \
RELEASE_MAESTRO_CDP_PORT=9300 \
RELEASE_MAESTRO_INSPECTOR_PORT=5900 \
make dev-reallocate
```

`RELEASE_MAESTRO_APP_DATA_DIR` selects a different writable app-data directory.

## Lifecycle and claims

An allocation starts **reserved**. A holder is a concrete process using it, such as the dev
supervisor or an MCP wrapper. The allocation is **active** while at least one holder remains. After
the last holder leaves, it is **inactive** for a 20-minute grace period, then **expired** and
available for reclamation. An absent registry allocation with a local manifest is **reclaimable**.
If the last dev holder exits while a bundle listener remains, the allocation reports
**unverified-listener** until that port is free. A remaining MCP holder keeps the state **active**
with degraded health.
The manager checks process start identity as well as PID before accepting a holder. A clean
SessionEnd hook requests release when idle; `/clear` keeps the session's allocation. Hooks are
advisory, so normal commands also reconcile dead holders and expired allocations.
If another checkout appears at an allocation's old path, the old allocation enters the same
missing-worktree grace period. A moved checkout keeps its allocation when it runs a command from
its new path during that period.
[Claude Code removes Git worktrees itself](https://code.claude.com/docs/en/hooks#worktreeremove) and
fires `WorktreeRemove` alongside that cleanup. The hook releases the allocation after the directory
disappears and its holders and unverified listeners exit.
It records the removal request first, so a later manager command completes the release if deletion
outlasts the hook's verifier.

Set `graceMs` in `~/.release-maestro/dev-instances/settings.json` to change the grace period for
all worktrees, for example `{ "graceMs": 600000 }`. `RELEASE_MAESTRO_INSTANCE_GRACE_MS` overrides
the setting for one command. `0` releases an inactive allocation at the next reconciliation.
`RELEASE_MAESTRO_STARTUP_TIMEOUT_MS` sets a deadline for each renderer and Electron startup, including
listener ownership checks. The default is ten minutes per process. A child exit fails startup immediately.

A claim names a mutable resource held by a workflow. `make dev` and Electron E2E both use the
Electron development build, so the manager rejects that overlap in one worktree. Electron E2E and
renderer E2E can run together. Two copies of the same mutating E2E target cannot. E2E workflows
get transient bundles, which are released when their commands exit. MCP wrappers share their
worktree's stable development bundle and may run before `make dev`.
On Windows, development, MCP, and E2E launchers use process jobs so descendants stop with the
launcher or keep its allocation active until they exit.
On macOS and Linux, the manager records a verified E2E renderer listener so its claim survives an
abrupt test-runner exit until the listener stops. If a runner exits before the listener can be
verified, an occupied transient renderer port keeps the claim until the port is free.
If a dev launcher exits before its listener can be verified, an occupied port in its bundle keeps
the development and Electron build claims until the port is free.

## Recovery

Use `make dev-status` for this worktree's development allocation and `make dev-list` for workflow
holders or other worktrees. `make dev-log` shows the event that caused a failure. If an unrelated
process took a persisted port, stop your dev stack and MCP clients, then run `make dev-reallocate`.
`make dev-stop` is the manual resort for stuck processes in agent terminals and orphaned E2E
processes. It checks both worktree ownership and process start identity before signaling them.
For a transient port with no verified holder, stop the port owner manually; the claim clears when
the port is free.
For an unverified dev listener, `make dev-status` and `make dev-stop` report its port and PID.
Stop it manually; `make dev-stop` will not signal a process whose ownership was not verified.
`make dev-release` only changes allocation state and never kills a process. `FORCE=1 make dev-release` can discard corrupt
ownership metadata, but still refuses live holders and unverified listeners and cannot bypass a registry recovery marker.

The registry and manifest are versioned. The manager repairs missing registries, stale locks, and
dead holders while preserving live processes. If neither registry copy is valid, it quarantines corrupt
copies and stops rather than discarding possible live ownership. After stopping the processes and
inspecting the quarantined files, run `make dev-recover` to clear the recovery marker and permit a
fresh registry. Older registry entries without checkout identity cannot be assigned to a replacement
checkout by path alone. Their live holders must exit before a new allocation can claim the same
resources. The central JSONL log rotates at about 5 MiB with three retained files. It records lifecycle events, ports,
holder identity, and conflict reasons, without application output or full command arguments.
