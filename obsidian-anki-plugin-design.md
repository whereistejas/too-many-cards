# Obsidian → Anki Plugin — Design Document

A custom Obsidian plugin that uses Anki (via AnkiConnect) as a synced backing store for flashcard notes, with `[[wikilinks]]` from regular vault notes rendering as enriched/foldable card UI.

## Goals & Scope

- One markdown file per Anki note. The file IS the card; no inline syntax.
- Note type is fixed to **Basic** (Front/Back). Cloze and other types are out of scope.
- A single Anki deck. No multi-deck support.
- Bidirectional sync with **last-write-wins** on Anki's `mod` timestamp.
- Card files are leaves — they don't link out. Other vault files link *to* them.
- Wikilinks to cards from non-card notes render with enriched UI (always-visible inline; callout-block with native folding).

Out of scope: cloze, multiple decks, multiple note types, conflict resolution beyond LWW, mobile-only sync flows, schedule/review state syncing.

## Storage Model

### Folder convention

- A single configured folder (default `Cards/`) holds every card file. Set globally in plugin settings.
- **Recursive**: subfolders inside `Cards/` are allowed. Folder structure is *not* significant — it's just for the user's organization.
- **Strict**: every file inside the cards folder is treated as a card. No exclusion mechanism (no `_index.md`, no `anki: false` opt-out). Users put non-card files outside the cards folder.

### Per-file structure

- **Filename** (without `.md`) = the **Front** field of the Anki note.
- **Body** = the **Back** field.
- **Frontmatter** is plugin-managed; the user never types it.

```yaml
---
anki_id: 1714567890123      # absent before first sync; bigint Anki note id
anki_mod: 1714567890        # Anki's notesInfo.mod, refreshed every successful sync
anki_status: [suspended]    # list; only [suspended] is currently meaningful, but list-typed for future flags
---
Body markdown becomes the Back field.
```

### Tags (derived, not stored)

Tags are recomputed every sync from backlinks; nothing is stored in the card frontmatter.

- For each card, query `app.metadataCache.getBacklinksForFile(file)`. This covers both `[[wikilinks]]` and `[md](links.md)` from anywhere in the vault.
- For each linker file, transform: linker filename (without `.md`) → Anki tag, with:
  - Spaces → underscores (`French Vocabulary.md` → `French_Vocabulary`).
  - Folder hierarchy → Anki's `::` nesting (`Topics/Languages/French.md` → `Topics::Languages::French`).
- **Filename-only.** The linker file's own `#hashtags` are *not* propagated to cards. Decided for predictability.
- The full tag set is rewritten on Anki on every sync of a card (cheap; one `replaceTags`/`updateNoteFields` call). No rename tracking needed — re-deriving from current backlinks naturally handles renames.

## Sync Strategy

### Last-write-wins on `mod`

- Anki tracks `mod` per note (Unix seconds, bumped on field/tag edits). AnkiConnect returns it via `notesInfo`.
- We mirror it in the file's `anki_mod` frontmatter after each successful sync.
- On each sync run, for each card with both sides present:
  - If `anki.mod > frontmatter.anki_mod` → Anki side changed → pull Anki content into file.
  - If file content hash differs from last-synced hash → Obsidian side changed → push to Anki.
  - If both → LWW: latest `mod` wins. Silently drops the loser. **This is intentional**; user is the sole editor and works one side at a time.

We do not detect true conflicts (no last-synced anchor stored). LWW only.

### Triggers

- **Manual:** `Sync to Anki` command (palette + bindable hotkey).
- **On save:** hook `app.vault.on('modify', file)`. Filter out files outside the cards folder before any other work (cheap short-circuit). Debounce per-file at ~1.5s (configurable via `saveDebounceMs`).
- **In-flight lock:** serialize sync runs. If a sync is already running and another triggers, queue at most *one* follow-up. Drop further triggers until completion.
- **Failures:** `new Notice("Anki sync failed: <reason>", 5000)`. Same notice mechanism for AnkiConnect-not-running, per-card failures, and CORS errors. No persistent status indicator anywhere in the UI.

### Status field (`anki_status`)

- List-typed. Currently only `suspended` is meaningful.
- **Asymmetric to LWW**: Obsidian's frontmatter is canonical for status; Anki's side is overwritten every sync.
- Reasoning: Anki's note-level `mod` doesn't bump on card-level suspend changes, so LWW can't apply. Document that users should toggle suspend in Obsidian, not Anki.
- Implementation per card after `addNote`/`updateNoteFields`:
  - `findCards({ query: "nid:<note_id>" })` → card id(s) (1 with Basic).
  - `suspend` or `unsuspend` based on whether `suspended` ∈ `anki_status`.

### Deletion (symmetric, with safety net)

| Obsidian state | Anki state | Action |
|---|---|---|
| File exists, no `anki_id` | — | Create in Anki. Write back `anki_id`, `anki_mod`. |
| File exists, `anki_id` present, matches Anki note | Note exists | Normal LWW reconcile. |
| File exists, `anki_id` present | Note absent | Treat as Anki-side delete → `app.vault.trash(file, false)` (Obsidian's `.trash/`, recoverable). |
| File absent | Note tagged `obsidian`, `anki_id` not in any vault file | Treat as Obsidian-side delete → `deleteNotes` in Anki. |

**Sanity check:** if a single sync run would delete more than **25%** of either side's cards, abort the entire sync and toast `Sync aborted: would delete N cards. Investigate or run with --force.` Catches "Anki was empty because the database hadn't loaded yet" and similar transients that would otherwise nuke the user's data.

**Orphan detection on Anki side:** every plugin-created note carries the tag `obsidian`. On each sync, `findNotes("tag:obsidian")` enumerates all plugin-managed notes; cross-reference with `anki_id` values across all vault files; the difference is orphans to delete.

### Duplicate handling

Two card files with the same basename (= same `Front`) are duplicates because Anki's duplicate detection rejects matching front fields.

**Detection:** before each sync, group all card files by basename (case-sensitive). Any group with >1 file is a duplicate group.

**Resolution:**
- If exactly one file in the group has `anki_id` (already synced), it keeps syncing. Others are skipped.
- If zero or multiple have `anki_id`, skip the entire group.

**Toast (one consolidated notice per run, ~10s):**
```
2 duplicate card names skipped:
- "avoir" (Cards/French/avoir.md, Cards/Spanish/avoir.md)
- "intro" (Cards/A/intro.md, Cards/B/intro.md)
```

## Markdown ↔ HTML Conversion

Anki stores HTML in fields. The plugin converts on each direction.

### Obsidian → Anki (export)

- Library: **`markdown-it`** (vanilla; predictable, no Obsidian-specific machinery).
- **Math:** transform Obsidian's `$…$` (inline) → `\(…\)`; `$$…$$` (block) → `\[…\]`. Anki renders MathJax natively for these. Apply on the markdown AST (text nodes only) so `$` inside code fences is left alone.
- **Code:** standard `<pre><code>` output. No syntax highlighting (would need CSS shipped into Anki templates; not worth it).
- **Images:** for each `![[pic.png]]` or `![alt](pic.png)`:
  - Resolve to a `TFile` via `app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)`.
  - `vault.readBinary(file)` → base64 → `storeMediaFile { filename: <hash>.<ext>, data: <base64> }`.
  - Filename = content-hash-prefixed (e.g., `pic-a3f1.png`). Always hash, even when there's no collision risk, so the rewriting logic is uniform and round-trips are stable.
  - Rewrite `<img src>` to the bare hashed filename (Anki's media folder is flat).

### Anki → Obsidian (import)

- Library: **`turndown`** for HTML → markdown.
- **Math:** inverse — `\(…\)` → `$…$`; `\[…\]` → `$$…$$`.
- **Images:** for each `<img src="<filename>">` in the field HTML, `retrieveMediaFile { filename }` → base64 → write to the configured media folder (default `Cards/_media/`). Rewrite to `![[filename]]`.

## Display in Other Notes

Wikilinks targeting a card file (any `[[link]]` whose resolved `TFile` is inside the cards folder) get custom rendering.

### Inline form (always-visible)

Default rendering for any `[[card-name]]` mid-prose. Renders as `card-name → bonjour` (filename + arrow + answer text). No reveal mechanic; the answer is always visible. Inline reveal is poor UX — don't try.

- Honor aliases: `[[card-name|alias]]` displays `alias → bonjour`.
- Broken/unresolved links: leave as Obsidian's default unresolved-link styling. Don't try to render a card.

### Block form (callout with native folding)

Custom callout type `card`:

```markdown
> [!card]+ [[bonjour]]
> [!card]- [[bonjour]]
> [!card] [[bonjour]]
```

The plugin populates the callout's title (= filename) and body (= rendered card body) from the `[[link]]` on the title line. Obsidian's callout fold mechanic does the reveal:
- `+` = expanded (answer visible).
- `-` = collapsed (answer hidden, click chevron to reveal).
- bare = non-foldable / default (depending on theme behavior).

**Constraint:** the `[[link]]` must be on the title line (next to `[!card]+`), not in the body. Document this. If absent or malformed, fall back to default callout rendering.

**Multi-link or zero-link in `[!card]` callouts:** defer to default callout rendering (don't touch the DOM). Detection: count `a.internal-link` elements in the title-line range. Cheap; no error/warning, just behaves as a normal callout.

### Implementation surfaces

- **Reading mode:** `registerMarkdownPostProcessor`. Walk the rendered DOM:
  - Find `a.internal-link`; for each, look up `app.metadataCache.getFileCache(targetFile)?.frontmatter`; if `anki_id` present, replace with the inline widget.
  - Find `div.callout[data-callout="card"]`; locate the `a.internal-link` in the title; populate title and body.
- **Live preview:** CM6 `ViewPlugin` building decorations from `syntaxTree(view.state)`:
  - For wikilink nodes (Obsidian's `hmd-internal-link` token), do the same target lookup; emit `Decoration.replace` with a `WidgetType` for the inline widget — but only when the cursor's range doesn't intersect the link (otherwise fall back to source for editability).
  - For callout nodes typed `card`, decorate the title and body ranges similarly.
- **Shared rendering:** one `renderCardLink(targetFile, container, mode)` and one `renderCardCallout(targetFile, titleEl, bodyEl)` function called from both reading-mode and live-preview entry points. Don't duplicate.

## Commands

- **`Sync to Anki`** — manual one-shot of the on-save logic across the whole cards folder. Same code path as the on-save trigger but unconditional (ignores debounce, ignores in-flight lock by queueing as a normal follow-up).
- **`Pull plugin-managed notes`** — re-sync notes already tagged `obsidian` in Anki back into the vault. Scope: `findNotes("tag:obsidian")`. Skips notes whose `anki_id` already appears in some vault file (it just runs the normal LWW reconcile). Use case: reinstall, cross-machine sync.
- **`Import deck…`** — first-time import of an existing Anki deck. Prompts for deck name. Scope: `findNotes("deck:<name>")`. Tags every imported note with `obsidian` as part of the import (marking them plugin-managed going forward). Skips non-Basic note types and toasts the count at the end.

## Bulk Operations

### Bulk export (Obsidian → Anki)

- Use AnkiConnect's `addNotes` (plural). Batch ~50–100 per round-trip.
- Returns array of note IDs (or `null` for failures, e.g., duplicates rejected by Anki).
- After each batch, follow up with `notesInfo` for the new ids to grab `mod`, then write back `anki_id` and `anki_mod` via `app.fileManager.processFrontMatter(file, fm => …)` (preserves frontmatter ordering and unrelated keys).
- Persistent progress notice: `const notice = new Notice("Syncing 0/N…", 0)`; update with `notice.setMessage(…)` after each batch; `notice.hide()` when done.
- Per-card failures: collect, toast a summary at the end. Don't stop the run.

### Bulk import (Anki → Obsidian)

For each Anki note in scope:

1. Check if `anki_id` appears in any current vault file's frontmatter. If yes, skip (already in vault).
2. Sanitize the `Front` field for filename use:
   - Strip HTML tags.
   - Replace filesystem-illegal chars (`/\:*?"<>|`) with `_`.
   - Truncate to ~120 chars.
   - On collision with an existing card filename, append `-2`, `-3`, etc.
   - Toast a summary of any non-trivial sanitizations at end of run.
3. Write file:
   - Filename: sanitized Front + `.md`.
   - Body: `Back` field through `turndown`, then math/image inverse rewrites.
   - Frontmatter: `anki_id`, `anki_mod`, `anki_status: [suspended]` if `areSuspended` returns true.
   - No tags written (they're derived from backlinks; new imports have no backlinks → no tags is correct).
4. Skip non-Basic note types. Count and toast at end (e.g., `12 cloze notes skipped — only Basic is supported`).

## Plugin Settings

```ts
interface PluginSettings {
  cardsFolder: string;        // default: "Cards"
  deckName: string;           // default: "Default"
  ankiConnectUrl: string;     // default: "http://localhost:8765"
  mediaFolder: string;        // default: "Cards/_media"
  saveDebounceMs: number;     // default: 1500
}
```

That's the entire surface. No per-card settings; nothing else needed.

## Plugin State

Use Obsidian's built-in `this.loadData()` / `this.saveData()` (writes to `data.json` in the plugin folder). Persisted state:

- In-flight sync flag (boolean) — guards against parallel runs across reloads (clear on plugin load to avoid stuck state).
- Last successful sync timestamp (Unix seconds) — for first-run-on-this-vault detection and possibly debug display.
- "First-run AnkiConnect-unreachable notice already shown this session" boolean (in-memory only, not persisted).

Don't roll a custom state file.

## First-Run UX & AnkiConnect Setup

### Detection

On every sync attempt, the first AnkiConnect call (e.g., `version`) may fail with:
- Network error → Anki desktop not running, or AnkiConnect addon not installed.
- CORS error → AnkiConnect running but origin not allowed.

### CORS

AnkiConnect ships with `webCorsOriginList: ["http://localhost"]` by default. Obsidian's webview origin is `app://obsidian.md`. Users have to add it to AnkiConnect's config once (via Anki's Tools → Add-ons → AnkiConnect → Config).

- README documents the one-time setup.
- On detected CORS error in a sync run, toast specifically: `AnkiConnect rejected origin. Add "app://obsidian.md" to webCorsOriginList in AnkiConnect's config.`

### First failed connection per session

On the first failed connection in a session (no AnkiConnect at all), show a notice with a one-line install hint instead of the generic error toast. Subsequent failures in the same session use the generic toast. Reset on plugin reload.

## Implementation Notes / API Cheat Sheet

### Obsidian APIs

- `app.vault.on('modify', file)` — sync trigger.
- `app.vault.trash(file, system: boolean)` — non-destructive deletion. Pass `false` to use Obsidian's `.trash/` (recoverable from inside Obsidian); `true` for system trash.
- `app.metadataCache.getFileCache(file)` — returns frontmatter, headings, links, etc.
- `app.metadataCache.getBacklinksForFile(file)` — backlinks for tag derivation.
- `app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)` — resolve `[[link]]` or relative `[md](file.md)` to a `TFile`.
- `app.fileManager.processFrontMatter(file, fn)` — safely mutate frontmatter without clobbering other keys / formatting.
- `vault.readBinary(file)` — for image bytes.
- `registerMarkdownPostProcessor(fn)` — reading-mode rendering hook.
- CM6 `ViewPlugin` + `Decoration.replace` + `WidgetType` — live-preview rendering hook. Re-build decorations on `update.docChanged || update.selectionSet || update.viewportChanged`.
- `new Notice(text, timeoutMs)` — toasts. Pass `0` for sticky; `notice.setMessage(...)` to update; `notice.hide()` to dismiss.

### AnkiConnect actions used

- `version` — health check / detection.
- `addNote`, `addNotes` — create.
- `updateNoteFields` — update Front/Back.
- `notesInfo` — read current state, including `mod`, fields, tags.
- `findNotes(query)` — `tag:obsidian`, `deck:<name>`, etc.
- `deleteNotes` — delete on Obsidian-side removal.
- `findCards({ query: "nid:<id>" })` — card ids for a note (for suspend).
- `suspend`, `unsuspend`, `areSuspended` — status sync.
- `replaceTags` (or `updateNoteFields` with tag args, depending on AnkiConnect version) — overwrite tags from backlinks.
- `storeMediaFile`, `retrieveMediaFile` — image transport.

### Third-party libraries

- `markdown-it` — markdown → HTML for export. Use AST text-node hooks for math regex transforms.
- `turndown` — HTML → markdown for import.

### Round-trip stability

The lossy parts of round-tripping (Obsidian → Anki → re-import to a fresh vault):

- **Filename = Front.** A Front with `<b>bold</b>` HTML loses formatting after sanitization for filenames. Inherent to filename-as-Front; not fixable.
- **Tags.** Imported cards have no backlinks → no tags. Tags come back on next sync after the user adds the card to a topic file.
- **`anki_mod`.** Reset on import to whatever Anki currently reports; safe.

These are acceptable. Document, don't fix.
