# grdelina-photo-grid

A custom Directus interface for M2M-to-files fields (photo galleries), built for
the Grdelina project because Directus's built-in "Files" interface shows
thumbnails too small to tell similar photos apart, and that's a known,
permanent limitation of the built-in interface (not fixable via config).

## What it does

- Renders selected photos as a card grid instead of a cramped list.
- A Small/Large size toggle (not a live-resize slider — WordPress's Media
  Library tried that and walked it back as "jumpy and distracting"; a simple
  two-state toggle is what shipped and what's been loved for a decade).
- Drag and drop to reorder.
- Hover to reveal a remove button.
- Click a photo to open Directus's native file detail page (title,
  description, alt text, tags, folder) in a new tab — so you get full
  metadata editing instead of a bare enlarge-only preview, and never lose
  your place on the current form underneath.
- The first photo in the list gets a "Hero" badge, since several of our
  fields treat position 0 specially (Hero tiles, each Photo Tour section's
  large hero photo).
- Upload new files or pick existing ones from the media library, both via
  the same large-thumbnail grid.

## How it works

This interface does **not** use Directus's own internal relational-editing
machinery (`useRelationMultiple` etc.) — those composables are private to
Directus's own app bundle and aren't exposed to extensions. Instead, every
action (add / remove / reorder) writes directly to the field's junction
collection via the REST API as soon as you do it — there's no pending/staged
state and no need to click "Save" on the parent item afterwards for the
photos specifically. That's a deliberate simplification, not an oversight:
replicating Directus's internal staged-edit diffing correctly, from outside
the app, is a much larger and more fragile undertaking than this field
actually needs.

Following on from that: this component deliberately never calls `emit('input',
...)`. It's tempting to emit the current photo list anyway "just so the value
prop reflects reality", but Directus's core reads that as "this field changed"
and tries to persist it on Save using its own alias/M2M diff format — a plain
array of file ids isn't that format, and Directus fails by misreading a file's
uuid as this junction's own integer id. Symptom if this regresses: every item
you open prompts to save with zero real edits made, and clicking Save throws
`invalid input syntax for type integer`.

One consequence: it needs the parent item to already exist (a real primary
key), since there's nowhere to stage changes for an unsaved item. On a
brand-new, unsaved item the interface shows a notice asking you to save
first — save the item once, then add photos.

## Setup — per field

This interface only knows how to talk to a plain `<parent>_<field>`-style
junction (columns: `id`, `<parent>_id`, `directus_files_id`, `sort` — exactly
what Directus's own "Files" interface already creates), so wiring a field to
it takes two settings, filled in via **Settings → Data Model → (collection)
→ (field) → Interface**:

| Option | Example (Hero tiles) | Example (Photo Tour section photos) |
| --- | --- | --- |
| Junction collection | `apartments_hero_tiles` | `apartment_tour_sections_files` |
| Parent id field | `apartments_id` | `apartment_tour_sections_id` |
| Max photos | `3` | *(leave empty)* |

Currently wired up for:
- `apartments.hero_tiles` → `apartments_hero_tiles` / `apartments_id` / limit `3`
- `apartment_tour_sections.photos` → `apartment_tour_sections_files` / `apartment_tour_sections_id`
- `villas.gallery` → `villas_files` / `villas_id`
- `villas.gallery_featured` → `villas_featured_files` / `villas_id`

## Turning it off

Switch the field's Interface back to the built-in "Files" picker at any
time — the underlying data (the junction rows) is identical either way, so
nothing is lost or needs migrating. Uninstalling the extension entirely (via
Settings → Extensions, or by removing this package from the Directus
server's extensions folder) has no effect on any other part of Directus.

## Not built yet (deliberately deferred)

- Folder-scoped browsing in "Add Existing" (currently searches the whole
  media library by filename).
- Bulk multi-select in "Add Existing".

## Development

```bash
npm install
npm run dev     # watches src/, unminified
npm run build   # production build → dist/index.js
```

Deploy by copying this whole package into the Directus server's
`extensions/` directory (or wherever `EXTENSIONS_PATH` points) and
restarting Directus.
