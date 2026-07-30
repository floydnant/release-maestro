# maestro-core

Shared library: the Zod schemas, types, and utilities that both the Electron main process and the
Angular renderer depend on. The schemas in `src/schemas/` are the contract for everything crossing
the main/renderer IPC boundary and the metadata-engine boundary — a change here is a change to both
sides.

Both product contexts run through this lib; see [CONTEXT-MAP.md](../../CONTEXT-MAP.md) for which
schemas belong to which.

```bash
npx nx test maestro-core
npx nx build maestro-core
npx nx lint maestro-core
```
