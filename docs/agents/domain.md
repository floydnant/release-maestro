# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT-MAP.md` at the repo root, if it exists. It points at one `CONTEXT.md` per context.
- `CONTEXT.md` files for the relevant context, using the map when present.
- `docs/adr/` for system-wide architectural decisions.
- `apps/*/docs/adr/` and `libs/*/docs/adr/` for context-specific decisions when they exist.

If a file or directory does not exist, proceed silently.

## File structure

This repo is multi-context.

Expected layout:

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── apps/
    ├── electron-main/
    │   └── CONTEXT.md
    ├── maestro-electron/
    │   └── CONTEXT.md
    ├── maestro-renderer/
    │   └── CONTEXT.md
    └── maestro-renderer-e2e/
        └── CONTEXT.md
└── libs/
    └── maestro-core/
        └── CONTEXT.md
```

If a context needs its own architectural decisions, keep them in that context's `docs/adr/` directory.

## Use the glossary's vocabulary

When your output names a domain concept, use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the project explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use or there's a real gap to capture.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
