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
Directus's own app bundle and aren't exposed to extensions. Instead it
re-implements the same *contract* Directus's own "Files" interface uses:
add / remove / reorder only change local component state; nothing touches
the junction table until the parent item's own **Save** button is clicked,
and everything is discardable by navigating away instead — exactly like
every other field. It does this by emitting Directus's own documented
nested-relational payload shape via `emit('input', ...)`:

```json
{ "create": [{ "directus_files_id": "...", "sort": 10 }],
  "update": [{ "id": 7, "sort": 20 }],
  "delete": [3] }
```

Directus's core reads that shape and applies it against the junction
collection itself when the parent item is saved — this interface never
writes to `/items/<junction>` directly except to load the *currently saved*
photos on mount. (An earlier version of this file skipped all of this and
wrote straight to the API on every action instead, to avoid reimplementing
Directus's staging contract. That turned out to be the wrong tradeoff: it
looked like it worked, but it meant photo changes couldn't be discarded by
navigating away like every other field, and separately, an unrelated attempt
to satisfy Vue's `value` prop by emitting a bare array of file ids corrupted
Directus's own Save entirely — it read a file's uuid as if it were the
junction's own integer row id and threw `invalid input syntax for type
integer`. Don't reintroduce direct-API-write-on-every-action or a bare-array
emit; both were tried and both broke in ways that only showed up in real use.)

**New file uploads are the one deliberate exception**: the binary has to
exist as a real `directus_files` row immediately (same as native Directus's
own Files field) — only the *link* to this parent record is staged, not the
upload itself. Cancelling the form afterwards leaves the uploaded file
sitting unlinked in the media library, which matches Directus's own native
behaviour in this exact scenario.

One consequence of needing a real junction to load from: this interface
needs the parent item to already exist (a real primary key), since there's
nowhere to fetch the current photo list from for an unsaved item. On a
brand-new, unsaved item it shows a notice asking you to save first — save
the item once, then add photos. (Staging creates for a *new* item without
an existing junction to read from would be a reasonable future improvement,
just not attempted yet.)

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

## Using this field inside a nested item (e.g. Photo Tour Sections)

`apartment_tour_sections.photos` is edited through a nested drawer, opened
from the `apartments.tour` list-o2m field. Two things about that drawer
surprised us in testing and turned out to be normal Directus behaviour, not
bugs in this extension or something we can change from inside it:

- **The drawer's own checkmark/Save button doesn't write to the server.**
  It only folds your photo change into the *parent apartment's* own pending
  edits and closes the drawer — exactly like every other field inside a
  nested o2m item. The apartment's sidebar Save button turning purple right
  after you close that drawer is correct: it means there's now a staged
  change waiting for the apartment's own Save. Nothing is actually persisted
  until you click that. Skipping it (navigating away, or hard-refreshing the
  browser) discards the staged photo change — same as it would for any other
  unsaved field. Directus does warn you before this happens: an in-app
  "Discard Changes / Keep Editing" dialog on in-app navigation, and the
  browser's own native "Leave site?" prompt on a hard refresh or tab close —
  both driven by the same underlying "this item has unsaved edits" flag
  (`hasEdits` in Directus's `use-item` composable). It's easy to blow past
  the native browser one without registering it as a warning, since it looks
  like a plain OS dialog rather than part of the page.

- **Closing that same drawer via Cancel/X/Esc never shows a "Discard
  Changes?" confirmation**, even with photos changed, and this is true for
  *every* field in a nested item drawer, not just Photos. We traced this
  into Directus's own source (`overlay-item.vue`): the confirmation is
  gated behind a `preventCancelWithEdits` prop that only Directus's own
  Visual Editor ever sets to `true`. The stock `list-o2m` interface that
  opens this drawer never does, so Cancel always discards silently by
  design. There's no way to add that confirmation from inside a field-level
  interface extension — it lives entirely in Directus core, outside
  anything this package touches.

**Bottom line:** a photo change made inside a Tour Section's drawer only
really "sticks" once you (1) confirm it with that drawer's own checkmark,
*and* (2) click the apartment's own Save. Doing only the first step and
then navigating away or refreshing will lose it, regardless of what state
the buttons were in right before you left.

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
