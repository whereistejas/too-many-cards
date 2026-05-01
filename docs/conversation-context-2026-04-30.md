# Conversation context (2026-04-30)

This file captures the key decisions and implementation work completed in this chat session for the Obsidian → Anki plugin.

## High-level outcomes

- Implemented the plugin spec from `obsidian-anki-plugin-design.md` into a modular codebase.
- Added a full sync pipeline with AnkiConnect, card parsing, conversion, rendering, commands, settings, and debug tooling.
- Switched project workflow from npm to Bun (by explicit user request), including lockfile and CI updates.
- Added substantial integration/unit test coverage for Anki-facing behavior.
- Removed automatic sync triggers and made sync manual-only.

## Major feature and behavior changes

### Core plugin and sync

- Replaced sample plugin scaffolding with real plugin code in `src/` modules.
- Added commands:
  - `Sync to Anki`
  - `Pull plugin-managed notes`
  - `Import deck…`
  - `Create new card`
  - `Create cards from [!card] callouts`
  - `Copy debug log`
  - `Clear debug log`
- Added sync queue/locking and robust notices/debug logs.
- Fixed pull flow to import managed notes instead of hitting delete-sanity abort.
- Made sync manual-only (removed automatic mode-switch/save sync behavior).

### Card file model

- Frontmatter updates:
  - `anki_mod` replaced by `last_modified` (ISO string).
  - Legacy `anki_mod`/`anki_id` cleaned up on sync write.
  - `aliases` used (not `alias`).
  - `back` property now stored in frontmatter.
  - canonical tag property is now `tags` (removed active use of `anki_tags`; cleaned during sync).
- Filename policy:
  - card files use `<note_id>.md` after sync/import.
  - note-id filename is treated as primary ID source.

### Tag policy

- Added configurable sync marker tag via settings: `syncTag` (default `obsidian`).
- Backlink-derived tag behavior changed:
  - tag name is based on linking note title (`frontmatter.title`) when present, else basename.
  - no path hierarchy in Obsidian tags.
- Added conversions:
  - Obsidian `/` ⇄ Anki `::` conversions for nesting compatibility.
- Managed tags are merged/deduped and always include `syncTag`.

### Rendering/UI

- Reading-mode rendering for inline card links and `[!card]` callouts.
- Improved card callout styling to be theme-native and Q/A card-like.
- Added hover action buttons on callouts (open card note, copy card).
- Fixed folding/collapse handling for `[!card]-` and `[!card]+`.

### Callout-to-card creation workflow

- Added command to convert callouts in active note:

```md
> [!card] My new question?
>
> My answer
```

- Command creates Anki note + card file and rewrites callout to:

```md
> [!card] [[<note_id>]]
```

(while preserving fold metadata where applicable).

## Tooling/package manager migration

- Migrated to Bun workflow:
  - removed `package-lock.json` and `.npmrc`
  - added `bun.lock`
  - set `packageManager` in `package.json`
  - updated docs/commands and CI workflow to Bun
- Updated `version-bump.mjs` to read version from `package.json` directly.

## Tests added/expanded

### Integration tests (real AnkiConnect)

- `tests/integration/anki-tags.integration.test.ts`
- `tests/integration/anki-commands.integration.test.ts`
- `tests/integration/anki-status.integration.test.ts`

Coverage includes:

- incoming-link tag add behavior
- managed tag add behavior
- deck note fetching/splitting Basic vs non-Basic
- managed note discovery by sync tag
- suspend/unsuspend status mapping

### Unit tests

- `tests/unit/anki-tag-policy.test.ts`
- `tests/unit/obsidian-tag-policy.test.ts`

Coverage includes conversion and policy helpers:

- `/` ⇄ `::`
- normalization
- title-vs-basename resolution
- managed tag merge/dedupe

### Test cleanup hardening

- Added shared integration cleanup helper:
  - tracks decks/notes/tags per test
  - retries deck deletion
  - clears unused tags
  - asserts no tracked decks remain

## Key code modules introduced

- `src/sync-service.ts`
- `src/anki-connect.ts`
- `src/conversion.ts`
- `src/card-parser.ts`
- `src/rendering.ts`
- `src/settings.ts`
- `src/types.ts`
- `src/anki-command-api.ts`
- `src/anki-tag-policy.ts`
- `src/anki-status-policy.ts`
- `src/obsidian-tag-policy.ts`
- `src/prompt-modal.ts`
- `src/utils.ts`

## Current validation state (during this session)

- `bun run build` passed.
- `bun run test` passed (unit + integration).

## Notes

- A lot of repo files are modified in this single session (scaffold replacement + feature work + migration + tests).
- This markdown serves as a human-readable audit trail/context snapshot for future continuation.
