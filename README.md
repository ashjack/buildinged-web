# BuildingedWeb

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 16.1.0.

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## BuildingEd file compatibility

The editor imports native TBX versions 2 and 3 and exports version 3. Version 1
files use an older tile-name format and must first be opened and saved in desktop
BuildingEd. Unsupported versions and invalid table references are rejected before
replacing the open building.

Older web version 0 files are upgraded on import. Missing CSV commas between rows
are repaired, and the old extra room-grid border is removed only if it is empty.
An occupied border produces an error so rooms are not silently discarded.

TBX tests cover native CSV layout, tile and furniture references, metadata
round-trips, template offsets, legacy grid recovery, and editing/export integration.
Run them with `npm test -- --watch=false --browsers=ChromeHeadless`.

## Editing document

NgRx owns the building document. Tools dispatch edits; document effects rebuild
the room, object and tile projections and cache the latest document after a short
debounce. Room and tile drags commit one rectangular edit per gesture. Rendering,
previews and visibility changes do not modify the saved document.

Object UIDs identify objects across all floors for updates and deletion. They are
assigned when opening/adding objects, remain stable during editing, and are omitted
from native TBX exports. Generated object tiles and manual tile overrides are
projected separately, so removing an object restores the underlying scene.

## Undo, redo and erasure

Each completed edit is one undoable command, including rectangle drawing/erasure,
object placement/deletion, and roof-cap changes. The editor retains the latest 100
commands in memory. Undo/redo restores object UIDs, definition tables and the
command's floor. Opening or creating a building clears history; history is not
included in exported TBX files or the recovery cache.

- Use the toolbar buttons or Ctrl/Cmd+Z to undo; Ctrl+Y or Ctrl/Cmd+Shift+Z to redo.
- Shortcuts leave text inputs and contenteditable fields to the browser.
- Ctrl-drag with the room, tile or furniture tool erases on the selected floor.
- Right-click or Delete removes the hovered object on the selected floor.
- Escape or right-click cancels an unfinished gesture. Releasing outside the canvas,
  changing tools/floors/documents, or losing window focus also cancels it.

Hold the middle mouse button to pan, including while holding left during a tool
drag. Panning pauses updates to the tool endpoint. Release middle to resume the
same edit, then release left to commit it. Releasing middle outside the canvas
does not cancel the edit; releasing left outside still cancels it.

Ctrl+wheel zooms around the pointer using the native stops: 6%, 12%, 25%, 33%,
50%, 75%, 100%, 150%, 200%, 300% and 400%. Fine-resolution wheel input uses
`Zoomable`'s bounded fractional scaling. Ordinary wheel input scrolls vertically;
Shift+wheel scrolls horizontally. Panning is limited to the scene's map border,
floor levels and committed sprite overhangs. An axis that fits in the viewport
is centered and cannot be panned away. Opening a document centers its scene;
window resizing and toolbar wrapping resize the canvas and preserve the scene
center within those bounds. Navigation never changes the building document.

## Selection, movement and editing tools

- **Move objects:** click an object or drag a rectangle. Shift adds to the selection;
  Ctrl subtracts. Drag a selected object to move the group by UID.
- **Move rooms:** select a rectangle, then drag inside it. Ctrl applies the move to
  every floor; Shift includes objects whose origins lie in the rectangle.
- **Move tiles:** select and move manual tiles on the palette's chosen layer.
  Generated tiles continue to follow room and object data.
- Use arrow keys to nudge any selection and Delete to remove it. Escape/right-click
  cancels a drag; when idle, it clears the selection. Switching tools, floors or
  documents clears selections. A move that would put part of the selection or an
  object footprint outside the document is rejected as a whole.
- **Wall:** choose interior/exterior wall and trim definitions in the options panel,
  including None. The small green cursor snaps to grid intersections. Drag to draw
  a thin wall strip. Hover a wall to show its endpoint resize handles; resizing
  clamps to the building bounds and a minimum length of one. Alt-click picks its
  materials; right-click deletes an object or cancels an unfinished wall.
- **Stairs:** choose a tile definition, then move within a cell to set direction.
  The nearest N/E edge selects W stairs; W/S selects N stairs, following the native
  tile-space distance rules. Left mouse-down places stairs immediately and freezes
  the cursor until release. Right-click deletes an object; Alt-click picks the
  stair tiles. Placement validates all five squares inside the building, excluding
  the outside border. No manual direction selector is required.
- **Roofs:** drag from a cell to create a roof, with the native type-specific size
  constraints and reverse-drag anchoring. Mouse position within a cell selects
  half-depth slopes and the supported corner types. Hover a roof to reveal its
  half-tile southeast resize handle and type-specific cap handles. Click a cap
  handle to toggle it off or on; crossed handles remain available. Flat roofs have
  central depth +/− buttons for Zero through Three, crossed at the limits. Resizing
  previews a temporary projection, commits one command on release, and preserves
  position, UID and materials. Right-click cancels creation/resizing, or deletes an
  object when idle. Ctrl does not change the native roof tool into an eraser.
- **Manual tile tools:** the tile palette offers Rectangle, Brush, Eraser, Flood fill,
  Pick and Capture. Brush strokes interpolate across skipped mouse cells. Ctrl
  erases manual overrides and Alt-click picks a rendered tile on the chosen layer.
  Right-drag captures a sparse pattern of manual tiles; Brush stamps that pattern
  without filling its transparent gaps. Clear the pattern or choose a palette tile
  to return to a single-tile brush. Fill matches connected rendered tiles on the
  chosen layer. Captured patterns are session-only and clip at document boundaries.

Each move, group deletion, wall resize, brush stroke, fill or stamp is a single
undo command. These tools edit the authoritative document; previews and selection
highlights do not change saved data.

## Native square generation

`services/native-squares.ts` derives a complete tile projection directly from the
building document. Its passes follow `BuildingFloor::LayoutToSquares` and
`Square::Replace*` in the supplied BuildingEditor C++ source: room boundaries,
standalone walls, wall-replacing furniture, wall joins/end caps, openings and
objects, floors and effects from below, then trim and grime.

This includes mixed-material corners, directional door/window wall cuts, frames,
interior/exterior curtains, exterior shutters, furniture orientation fallbacks and
bounded layer stacks. Stairs draw three steps and remove the three corresponding
generated floor squares above. Manual tile layers override the completed
projection, including stair holes.

Roof matrices follow `RoofObject::*Tiles`: slopes, peaks, dormers, shallow roofs,
corners and flat tops. Native half-depth caps, saved flat-roof depth, default cap
flags, square-coordinate tile offsets, border clipping and depth-three tops on
the next floor are supported. Some roof orientations expose only cap faces in the
native isometric view. Exterior trim and exterior grime are ground-floor only.

Tests assert source-derived square coordinates, layers and tile enums, and cover
document rebuild and TBX save/reopen behavior. They do not compare rendered pixels
against a running desktop editor. Special grime variants that depend on native
`.tiles`/`.tiledef` sprite properties remain unavailable because the web tile
catalog currently contains images without those properties.

The toolbar follows the native object toolbar and uses the original TileZed
icons. Standard roofs (including dormers and flat tops), shallow roofs and roof
corners each have a split button: click the icon to reuse that group's last roof,
or open its arrow menu to select a type. Roof type selection lives in the toolbar.

Click the `Floor n/count` label to open Floors. Floors are listed highest first;
add and duplicate insert above the selected floor, and the arrows reorder whole
floors with their rooms, objects and manual tiles. Add, duplicate, remove and
reorder support undo/redo and TBX save/reopen. Duplicate objects receive fresh
UIDs. The native limit of eight floors and a minimum of one floor are enforced.

The Rooms button beside the room picker opens the room editor. Add, duplicate,
remove or reorder rooms; edit their display/internal names, colors and materials.
New rooms receive an unused native
name/color and default wall, trim and floor entries when available. OK applies
the dialog as one undoable edit, while Cancel or Escape discards it. Room-grid
indices on every floor are remapped when rooms move or are removed, and the
selected room is ready for painting after applying the dialog.

Select a room tile category and click `Choose…` (or double-click the category)
to open the thumbnail Tile Picker. It includes None, filtering, zoom, keyboard
navigation and double-click selection. `Tiles…` opens the separate default tile
library: browse downloaded tilesets, select sprites and click + to create reusable
category entries. Ctrl/Shift select several sprites. Walls, trim and grime use
the native enum/neighbor offsets; the variants panel permits individual sprite
and offset edits. Library entries can be removed, reordered and undone/redone.

The Tiles toolbar's Expert Mode button switches to the native shadow-template
grid. Each slot represents one wall, trim, floor or grime variant; + inserts a
blank entry after the current entry. Drag a tileset sprite into a slot, or select
a slot and use the selected sprite button. Ctrl/Shift select slots for batch
clearing; removing selected slots' rows removes their complete entries. Tile
Offset edits the active slot's x/y position in the native range -3 through 3,
with the isometric displacement previewed over its shadow. Double-click a slot
to reveal its sprite in the tileset browser. Blank and duplicate entries persist,
and the expert preference and library zoom are remembered. Slot assignments,
clears, offsets, insertions and removals use the library's undo/redo history.

Closing the Tiles library saves its changes in this browser, as the native dialog
does on Done/Escape. These presets remain available across buildings even if the
picker or Rooms is canceled. A room assignment only changes on picker OK followed
by Rooms OK; its tile definition is interned into the building in the same undo
command and survives TBX save/reopen. Tile previews and the sprite browser use
the downloaded tilepack database; missing images show the native placeholder.

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.io/cli) page.
