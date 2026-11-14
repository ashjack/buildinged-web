# BuildingedWeb

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 16.1.0.

## Development server

Run `npm start` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

### Local frontend and API iteration

Run the Functions emulator from the workspace root in one terminal:

```powershell
firebase emulators:start --only functions --project buildinged-online
```

In another terminal, from `buildinged-web`, run `npm run start:local`, then open
`http://localhost:4200/worlded`. Both servers watch their source files. This
command configures the browser to use the API on `127.0.0.1:5001`; no deployment
is needed. Google sign-in and the existing cloud Datastore/private bucket are
still used, so edits saved during local testing update the existing project data.
Private file reads go through the existing authenticated API using the signed-in
website account; the developer CLI login does not need direct bucket read access.
Regular `npm start` uses the deployed API instead. Keep using the same browser
origin and API URL to reuse the same cached download between iterations.

## Hosted project worlds

The app opens Thames Valley (`35a386b9-0ced-4aa0-8a1b-7e3e06c9221e`) directly.
Project routes for other IDs redirect to Thames Valley. Its public building tasks
can be viewed without signing in. Start a named variant from a task, edit it, and
enter **Your name** when submitting for review. Guest variants stay entirely in
browser storage until submission; no anonymous Firebase account is created.

Guest drafts are independent local copies, scoped to the API URL and draft ID.
Edits are cached automatically, on page hide, and before leaving/closing. Reopen
the task and choose **Resume** under **Your variants in this browser**, or revisit
the variant URL. Save local draft and Export .tbx are also available. Failed
submissions keep both the edited document and entered name. A successful submission
keeps a local copy and creates a separate, reviewable server contribution without
changing the task's pinned source. Browser storage must be available; drafts stay
on the same browser/device and are removed if its site storage is deleted.

The app does not read/store visitor IP addresses, initialize analytics, or create
guest identity cookies. Deployment runs `scripts/configure-privacy.ps1` to exclude
Cloud Run, Functions, Firebase Hosting and Storage request logs containing visitor IPs from
non-required project log sinks, preserving other exclusions. This stops future
retention in those sinks; it does not delete old logs or control Google's separate
infrastructure processing or required administrative audit records. See
[Firebase request logging](https://firebase.google.com/docs/hosting/web-request-logs-and-metrics).
Google sign-in and existing permissions still protect administration, TileZed,
WorldEd, shared building edits, and non-public API routes. Only scoped `/guest/`
task reads and guest building submissions bypass Google authentication.

In TileZed, admins can choose **Place building** (L) to browse the project's TBX
buildings. The sidebar provides a searchable, paginated thumbnail grid, a larger
selected preview, and tile dimensions. Only the visible page requests thumbnails.
Move over the map to see a translucent building and its footprint before clicking
to place it. Like native WorldEd's `DnDItem`, the cursor snaps to the nearest tile
intersection with the building's centre tile as the hotspot. Escape or right-click
cancels placement. Buildings are placed on level 0 and share undo/redo with tile
edits. **Save map to project** saves the TMX and the selected PZW cell's lot list
in one world revision. Local maps export new placements as native TMX lot objects;
choose the project folder to browse unplaced local TBX buildings. Placement never
saves automatically.

Use **Move buildings** (M) to select and drag an existing placement. The grabbed
tile stays under the cursor, following native WorldEd `SubMapTool` drag offsets.
The building previews its new position while dragging; dropping records one undo
step. Escape, right-click, or pointer cancellation restores its original position.
Press Delete/Backspace or choose **Delete building** to remove the selected placement.
Right-click a lot for **Move building** and **Delete building** as well. These actions
work on existing WorldEd lots, embedded TMX lots, and newly placed buildings, including
lots whose preview is unavailable. Undo/redo includes both moves and deletions.
Nothing is saved automatically: manually save the map to persist its placements.
The building's TBX file remains available in the project. Local TMX saves update lot
objects in place; hosted saves retain native lot metadata while changing their bounds.

Admins can create a building from **World buildings → New building**. Choose its
name (or relative `.tbx` path), dimensions, and starter template, then edit it in
BuildingEd. **Save local draft** and the toolbar Save button keep the draft in the
current browser. **Add building to world** publishes it to the project's building
pool; it then appears in the World buildings list and WorldEd's lot picker. It is
not placed on the map until an admin adds a lot using it. A shared world must
already be uploaded, and publishing requires explicit project membership. Existing
paths cannot be overwritten by new buildings. After publishing, the editor uses
the normal manual **Save building to world** action.

Admins can choose **Create copy** in the World buildings list, the shared building
editor, WorldEd's lot controls, or a building's right-click menu in WorldEd or
TileZed. Choose a new path (a free `_copy` name is suggested), then edit the complete
source building as a local draft. **Add building to world** publishes the copy as
a separate file. Existing placements continue to reference the source; place the
copy from the building palette when ready. The create endpoint rejects existing paths.

BuildingEd's toolbar rotates the whole building left/right or flips it horizontally/
vertically, across every floor, as one undoable edit. These follow native
`BuildingFloor`, `BuildingObject`, `Stairs`, `FurnitureObject`, `WallObject`, and
`RoofObject` transforms: wall-edge anchors, stair length, resolved furniture sizes
and orientations, roof shape, footprint and cap directions are handled separately.
Painted cells move with the layout while retaining their tile artwork. Following
`TransformBuildingContents::prepare`, a painted border tile that would move outside
the area rejects the entire edit with an explanation; enlarge the area or move the
tile inward first. The original document and undo history survive a rejected edit.

Admins can edit an uploaded TBX directly from **World buildings → Edit building**,
or from a building lot in WorldEd's selected-cell controls. **Save building to world**
updates the shared building at the same path without creating a variant or requiring
review. Every placement using that path picks up the new building. Other world files
and existing task source snapshots stay unchanged. Saves require explicit project
membership and the current world revision; conflicts preserve local edits for export
or recovery. The editor's save icon also saves to the world in this mode.

In TileZed, admins viewing a hosted project cell can right-click a building's grey
overlay and choose **Edit building** to open the same editor. Building outlines
must be enabled. Clicking outside the menu or pressing Escape closes it.
**Create task from building** opens `/projects/:projectId/tasks/new` with that
world building selected in the existing task brief form. Project task-management
permissions still apply; the source copy and task are created only on submission.

From a project, choose **Shared world → Open project world**. Admin accounts
can upload a `.pzw` and its project folder,
or replace the hosted world. The folder must contain the same PZW and its
referenced cell maps, building lots and terrain/vegetation images. Missing or
absolute resource paths must be fixed before uploading. Uploads support PZWorldEd
Native256 and Legacy300 worlds, with an 8 MiB PZW, up to 4096 resources, 16 MiB
per resource and 512 MiB total resources.

Explicitly invited project members with Contributor or Admin accounts can open the world
without selecting local files. Public-project access alone does not grant hosted
world access. Invite collaborators through **Project access** first.

The project world opens as a fullscreen map with a compact zoom toolbar. Use
**Project controls** in the top-right corner to show project details, uploads,
warnings and the cell editor. The panel starts closed; **Close** or Escape hides
it without unloading the map or discarding edits.

Admins can click a cell in the overview, open **Project controls**, then **Edit selected cell** to change its map
assignment, add/move/remove building lots, or edit/add/remove zones. Choose
**Update map preview** to refresh the overview and **Save world to project** to
publish edits. WorldEd checks for updates every 30 seconds while visible and when
the window regains focus. **Check for updates** checks immediately.
Concurrent saves are checked by revision: a stale save is rejected and its edits
remain open. Remote changes wait while local edits are unsaved; checking manually
asks before discarding those edits.

The first visit downloads project resources and keeps their bytes in IndexedDB.
Later visits verify project access and the current revision, then reuse those
files. Unchanged worlds require only a small revision response. Changed worlds
download only missing or changed resources; server-generated SHA-256 hashes allow
unchanged content to be reused even if a replacement upload has new file IDs.
Uploads also reuse unchanged resources. Interrupted downloads retain completed
files and resume the remainder. Cache entries are separated by API, signed-in
account and project. Cache clearing or browser eviction requires another download;
a storage failure is reported while keeping the world usable.

The editor preserves the original XML outside the fields being edited, including
native settings, properties, roads, linked-world references and in-game map
features. Those features retain the existing viewer's rendering limits. Cell
terrain opens in TileZed, where admins can edit ground-level tile layers. Building
interiors open in the separate building editor. Hosted worlds are loaded from
the project, rather than restored from the local WorldEd snapshot; hosted cell
maps are not saved as TileZed's last local map.

The frontend and updated `workspaceApi` must both be deployed. Hosted worlds use
the existing private `BUILDINGED_BUILD_BUCKET`; see the functions repository's
deployment prerequisites. No direct public bucket access or browser storage
credentials are required.

## TileZed map editing

Open **TileZed** from the homepage, then choose a TileZed level-isometric `.tmx`
file. The viewer generates terrain from embedded BMP rules and draws
ground-level tile layers. Contributors can view maps; admins also have editing tools.
Choose **Pan**, middle-drag, or hold Space while dragging to pan; use the mouse wheel or zoom buttons to
zoom, and choose **Fit map** to return to the overview. The canvas also supports
arrow keys, plus/minus, and Home.

Press **H** to toggle **Highlight Current Level** without changing tools. It shows
only the active level, including only that level's tiles within buildings, and
tile picking ignores hidden floors. Press H again to restore all rendered levels.
The preference is remembered in this browser and does not change or save map data.
The current web map-editing level is ground level (0). This uses the desktop H
shortcut and level grouping; unlike desktop's dimmed lower levels, this mode
hides all other levels as requested. Pan remains available through its tool,
Space-drag and middle-drag.

Choose a visible **Layer**, then a tile from the **Tilesets** dock. The layer list
shows the topmost layer first, with the lowest layer at the bottom. **Add tile
layer** beside the list creates a named, empty ground-level tile layer above the
existing stack and selects it. **Raise layer** and **Lower layer** beside the
picker move the selected ground-level layer one position in the draw stack,
keeping it selected. Creation and reordering support undo/redo and remain unsaved
until the map is saved manually; saved TMX files retain the new layer order.
Layers whose names contain **AboveLot**, including **AboveLots** (`0_AboveLots`
in the map), render after buildings regardless of their position in the layer
list. Moving vegetation above AboveLots keeps vegetation below buildings.
Ordinary layers keep their relative order; AboveLot layers keep their own
relative order. This follows `CompositeLayerGroup::orderedCellsAt` in TileZed's
`src/tiled/mapcomposite.cpp`, which appends AboveLot tiles after building tiles
at each square. The picker follows the same named-layer rule.
The dock has a
searchable tileset list beside a continuous sheet preview, with zoom and background
color controls below. Drag across tiles or Shift-click a second tile to form a
rectangular stamp. Arrow keys select tiles; Shift+arrow extends the selection.
The editing toolbar uses TileZed's native tool icons, with names and shortcuts in
tooltips and accessible labels. Tools follow the desktop TileZed behavior:

- **Stamp brush (B)** paints a single tile or pattern; dragging draws a continuous stroke.
- **Bucket (F)** fills orthogonally connected matching tiles on the active layer.
  Shift-click fills the current selection, or the whole map when no selection exists.
- **Eraser (E)** removes tiles on the active layer, including generated terrain.
- **Rectangular select (R)** limits painting, filling, and erasing to a rectangle.
  **Use selection as stamp** / Ctrl+C captures its visible tiles; Escape clears it.
- **Pick tile (I)** samples the topmost opaque tile image directly under the cursor,
  including tiles on buildings and image overhangs. Transparent pixels reveal
  tiles behind them. It switches to the stamp brush; picking terrain also selects
  its layer. Building tilesheets not yet referenced by the map are added when needed.
- **Draw fence (G)** uses the native `Fences.txt` presets. Drag to preview a straight
  run along the dominant map axis; release to place it as one undoable edit. Sections
  alternate in native order and join perpendicular sections with corner pieces.
  Alt-click places a gate space in a fence or a standalone gate door; Ctrl-click
  toggles a post. Missing optional gate/post shapes do nothing. Escape or right-click
  cancels a pending run. The selection limits fence placement too.

Undo/redo is available in the toolbar and with Ctrl+Z / Ctrl+Y. Edits remain in
memory until **Save map to project** (hosted cells) or **Save .tmx** (local map
download). Ctrl+S also saves. Hosted saves require an invited admin and the world
revision captured when opening the cell; conflicts keep the edits open for export.
**Export .tmx** creates a backup without marking hosted edits saved. Leaving or
opening another map prompts before discarding unsaved work. No editing action
automatically saves to the project or the browser's last-map snapshot.

Refreshing a hosted cell reopens the last selected project, cell coordinates and
map path using the latest saved world and its current revision. Only this
selection is remembered; access is checked again before loading project files.
Opening a local map switches refresh restoration back to the local snapshot.

Saved edits use TileZed's native per-layer `bmp-noblend` masks, so hand-placed tiles
and erasures survive BMP regeneration. The writer preserves other layers,
object groups, embedded BMP images, rules, properties, and unknown XML elements.

Warnings are grouped into a compact **Show warnings** row above the map. Expand it
to inspect the details, or choose **Hide warnings** to regain map space. The browser
remembers this preference. Save errors and loading status remain visible.

Tilesheets cached by BuildingEd are reused automatically. Missing sheets are
retrieved individually from the same enabled tilepacks and cached in the browser;
2x sheets are preferred, with 1x sheets used when no 2x version is present.
Choosing local tiles remains an optional fallback for sheets outside those packs.

The last successfully opened TMX is saved as a browser-local copy and reopened
when returning to TileZed. Select the file again to pick up changes made outside
the viewer. Clearing browser site data removes the saved map and cached tiles.
The map and any selected local sheets are not uploaded. Missing or incompatible
sheets are reported in the viewer. Older saved maps are upgraded when reopened;
if the original file is no longer available, select an available copy.
TBX building lots are drawn as cached, roof-inclusive images over the terrain.
For standalone TMX lots, choose the project folder containing the map and its
referenced buildings. Cells opened from WorldEd receive their PZW lot placements
automatically, even when the exported TMX lot layer is empty. The last TMX
snapshot includes these placements and their referenced building files.
Non-lot objects, image layers, additional terrain levels, flipped tiles, and
external TSX tilesets are not supported in this initial viewer; unsupported content is
reported rather than silently presented as complete.

## WorldEd world viewer

Open **WorldEd** from the homepage to load an uploaded project world. Sign-in is
required. When one project is available it opens automatically; with several
projects, choose one from the list. The world and its referenced project files
are fetched from the server. Previous local world snapshots are not restored.
If the project has no uploaded world, the page shows that state and the admin's
upload controls instead of opening a local file. Existing project invitations
and admin-only upload permissions still apply.

The overview displays terrain images in an isometric cell grid and shows TBX
building lots with walls, furniture and roofs. Unavailable lots remain
footprints and are reported in the warnings.
Cell maps may contain changes not reflected in the terrain images.
Click a cell, then choose **Open terrain in
TileZed** to inspect its map. Drag to pan, use the mouse wheel or zoom buttons,
and choose **Fit world** to return to the overview. On the focused canvas, Enter
selects or opens a cell, and Shift+arrow keys change the selected cell.
World objects and zones, road objects, linked worlds and
in-game map features are not rendered in this initial overview.

Use **Check for updates** to pick up changes saved by another editor immediately.
Clearing site caches does not remove uploaded project worlds. BuildingEd's
existing tiles and tilepacks are reused when opening a cell in TileZed.

Building geometry is generated in a Web Worker using the existing BuildingEd
square/roof projection, with manual TBX tiles replacing generated tiles on the
same square, layer and level. WorldEd uses cached 256 px building thumbnails.
TileZed stores the individual tiles in cached image atlases, then decodes each
distinct source tile once across buildings in the current cell. It does not
retain an additional full-building image in that mode. Rendering follows the
native level-by-level, square-by-square diagonal order: ordinary map tiles,
building tiles, then AboveLot tiles at that square. It completes that square
before drawing the next, so nearer walls and upper floors can cover farther
AboveLots fences. Building floors and replacement layers suppress map tiles
at their own square using the C++ lot composition rules. Tile picking uses
the same ordered tiles as rendering.
PNG previews are cached by
file contents, width, floor and the content hashes of their referenced sheets,
with a 256 MiB LRU limit so a
whole world's thumbnails stay cached between visits. Previews whose only gaps
are sheets missing from the configured tilepacks are cached too (a published
pack that returns 403/404/410 counts as supplying no sheets, and is not
re-requested for a minute); transient failures are retried. Each viewer also caps decoded preview memory at 96 MiB.
Up to three previews render concurrently (lots are still placed in order), and
they share tilesheet lookups, the tilepack manifest and decoded tilesheets; the
decoded sheets (also capped at 96 MiB) are released after 10 seconds idle.
While buildings stream in, redraws are throttled. TileZed caches the composed
viewport until its map, camera, tile images or loaded buildings change.
Tilepack directory
indexes are reused for five minutes (at most eight packs), avoiding repeated ZIP
directory scans when different buildings request different sheets. Oversized or
unsupported buildings and missing tilesheets are reported explicitly. The
building preview supports TBX v2-v7 (room ceiling tiles are not drawn),
not TMX lot submaps or basement-access composition.

ZIP uploads through Tile Administration publish an immutable release ZIP and a
matching `SheetIndexUrl` sidecar containing each selected PNG's SHA-256 and size.
The manifest switches only after both are ready. Existing packs keep working;
upload their ZIP once through Tile Administration to enable per-sheet updates.
Old release ZIPs are retained so in-flight readers can finish safely.

Each pack's **Availability** in Tile Administration can be **Optional**,
**Required**, or **Disabled**. Optional packs start off until a user enables them
in BuildingEd's Tilesets popup. Required packs download automatically alongside
Vanilla and cannot be switched off in that popup. Disabled packs are hidden from
the popup and excluded from downloads, including preview asset requests, without
clearing previously installed local tiles or their cached version. Vanilla stays
required. Availability is saved separately in the public manifest's `Disabled`
and `Required` boolean fields and survives replacement ZIP uploads. Deploy both
the frontend and `adminApi` to enable the availability controls.

WorldEd checks the small manifest/index on opening, focus and once a minute while
visible; its toolbar also has **Check for tile updates**. TileZed checks on focus.
Unchanged PNGs remain cached even when the ZIP is repacked. Changed sheets are
read using ZIP byte ranges, verified against the index and cached by content
hash. Only buildings referencing those sheets are rebuilt, visible ones first,
with their current images retained until replacements are ready. These image
refreshes do not save or change the world, buildings or unsaved TileZed edits.
ZIP servers must support HTTP byte ranges. Legacy packs without an index retain
their previous cache behavior until republished.
Restart an already-running development server after this update so Angular
picks up the Web Worker build configuration.

### Zones and building outlines

TileZed draws zones (parking stalls, farmland, town zones, spawn points and other
WorldEd object types) over the map, plus a WorldEd-style outline for each
building lot. Like desktop WorldEd, each rectangle or polygon has a black shadow
edge, a coloured outline and a translucent fill; polylines are unfilled and
points are circles. Lots draw below zones; zones draw in level, group and
object order. Colours come from the PZW object group colour (WorldEd's dark grey
when the group has none). Zones stored in the TMX itself use their object group
colour, or TileZed's default grey. Cells opened from WorldEd receive that cell's
zones, which are saved with the map; reopen older maps from WorldEd to pick them
up. The **Zones** and **Building outlines** toolbar toggles are remembered, and
a legend lists the visible zone groups. Object labels, polyline widths and
TileZed's per-user object type colours are not shown, and the WorldEd overview
does not draw zones.

## Settings and saved data

The Settings page (`/settings`, linked from the homepage) has a **Clear data**
button. After confirmation it empties the site's cache databases (`tilesets`:
downloaded tilesheets and their metadata; `tilezed-viewer`: TileZed sheets,
building previews and the saved map copy; `worlded-viewer`: the saved world
copy), removes the `tilepack-version:*` download markers, then reloads the page.
It keeps building drafts (`buildingXml`, `buildinged:draft:*`), the Firebase
sign-in, tilepack enabled choices, the room tile library and UI preferences.
It is disabled while a tilepack download is running.

## Google sign-in and project workspaces

Google is the only supported login provider. Standalone TBX creation, import and
export remain available without signing in. Signed-in users can create projects;
the creator becomes the owner. Owners can invite contributors/reviewers by Google
account email or make their project public to all signed-in users. Invitees must
have signed in once before being added.

Use **Admin → Accounts** to assign Normal, Contributor or Admin to existing
Google users. New users default to Normal. Normal accounts can use the building
editor and create, save and submit building variations in accessible projects.
Contributors additionally have read-only WorldEd and TileZed access. Only admins
can change or upload worlds and use admin tools. Project membership and project
management roles still apply. The original admin UID
`gK0MQfxb5XVs8SGlF1GVKUYXQdK2` is permanently Admin and cannot be demoted.
Account types are stored on the server and checked on every API operation,
including local private-file forwarding. The browser reloads permissions on
sign-in and when its window regains focus; no new sign-in token is needed.

The homepage links to routed project workspaces. Shared tasks have no individual
assignee. Furnishing starts a private variant pinned to the task's original build
revision. **Save draft** stores a new variant revision, never the original.
**Submit for review** locks the submission; owners/reviewers can approve, request
changes or reject it. Approval completes the task. Reopening permits another
round of contributions without deleting previously approved work.

Open **World buildings** in a project (or **Buildings** in the WorldEd toolbar)
to browse the uploaded TBX files, sorted by their full relative paths. Search and
pagination keep large worlds manageable. **View** fetches only that building,
reuses the world file cache, and renders a preview with the configured tilepacks.
Owners and reviewers can choose **Create task** to fill in a furnishing brief.
Submitting the brief saves an immutable source copy, verified against the uploaded
file's checksum; repeated tasks reuse that copy. Later world replacements do not
change a task's source or any contribution variants.

Tile tasks display a brief, acceptance requirements and externally embedded HTTPS
reference images, with source links and an embedding-failure message. Tile work is
created outside this editor and submitted via an HTTPS deliverable link in this
first release; reference images are never uploaded or proxied.

### Local Firebase configuration

Keep the Firebase web initialization snippet in the ignored `firebase.md`.
`npm run configure:firebase` extracts only the six required browser configuration
fields into the ignored `src/assets/firebase-config.json`. `npm start` and
`npm run build` run this automatically. Do not commit either file, `.env` files,
server credentials, or generated build output.

This browser configuration is necessarily delivered to browsers and is **not a
server secret**. Project protection comes from server-side token verification and
project permissions, not hiding the Firebase web API key. Restrict the web API key
and authorized domains in Google Cloud/Firebase as appropriate. Never place a
service-account key in the browser configuration; the generator rejects
server-credential markers. Analytics is not initialized.

In Firebase Authentication, enable **Google**, configure its support email and add
your development/production hostnames to **Authorized domains** (including
`localhost` for development). Other sign-in providers must remain disabled.

The default API URL targets the existing project's `workspaceApi` function. To
override it locally, set a PowerShell environment variable before configuration:

```powershell
$env:BUILDINGED_API_URL = 'https://REGION-PROJECT.cloudfunctions.net/workspaceApi'
npm start
```

Signed-in requests obtain a Firebase ID token; public guest task requests do not.
Backend setup, storage permissions,
deployment and legacy migration are documented in
[the functions README](../buildinged-functions/README.md).

Local draft recovery is scoped by Firebase user, project and variant. Stale cloud
saves return a conflict rather than overwriting newer work. On conflict, export
the local TBX before using **Reload cloud copy**. The recovery cache is browser
storage, not encrypted storage: do not use a shared browser profile for private
project work. Cloud saving is explicit in this release, not background autosave.
Submitted variants are locked; download their TBX from the task page for
standalone inspection.

The pre-existing Thames Valley entities are not automatically migrated or exposed
through the new workspace. The migration utility must be reviewed and deliberately
run by a project administrator.

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

Workspace regression tests can be run alongside document/editor regressions:

```powershell
npm test -- --watch=false --browsers=ChromeHeadless --include='src\app\services\editor-session.service.spec.ts' --include='src\app\components\editor\editor.component.spec.ts' --include='src\app\components\project-workspace\project-workspace.component.spec.ts' --include='src\app\components\admin\building-selection-window\building-selection-window.component.spec.ts' --include='src\app\menu\menu.component.spec.ts' --include='src\app\services\document-integration.spec.ts' --include='src\app\services\building.service.spec.ts'
```

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
- **Furniture:** hovering wall cells automatically faces the furniture against the
  wall, including corner variants when available. Without a corner variant, the
  pointer's nearest edge chooses between the two walls. Click to place the preview,
  or hold and drag to override its facing. Drag direction uses eight sectors for
  furniture with corner variants and four otherwise, even beyond the grid edge.
  Missing variants fall back to an available cardinal or the selected orientation.
  Definitions marked **Walls** use the native artwork fallback (E/N reuse W;
  S reuses N, then W). These wall pieces match an existing wall on the grid edge
  under the pointer. If that edge has no wall, they use the facing selected in
  the sidebar and snap to the nearest parallel grid line. Walls on other edges
  do not pull the preview away from that line.
  Interior grid lines and the outer boundary are both available. Larger pieces
  stay aligned with the chosen line. Dragging retains that
  adjusted anchor, and placement is one undo/redo command. The preview uses the
  same wall-shaped grid overlay as a placed piece.
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

The Tile Mode sidebar follows the native Layers dock over tabbed Tilesets and
Furniture docks. Tilesets places the filtered sheet list beside an eight-column
sprite grid with shared tile/furniture zoom. Shift selects a rectangular pattern;
Ctrl selects individual sprites. Furniture choices paint manual tile patterns on
the current layer. Right-click a sprite to assign its Default Layer; the Layer
Switch button enables automatic layer selection for these saved assignments.
Layer checkboxes, Opacity, and the bottom-up Visibility slider affect the selected
floor's display without changing its tiles. Display settings survive rebuilds
and reset for a new document. The canvas resizes beside the dock.

Wall, stairs, door, window and furniture tools share the native-style Tiles and
Furniture sidebar. Material categories use the bundled native BuildingTiles.txt
catalog, room-library presets and document definitions, grouped by tileset.
Wall and trim choices apply to new wall objects; complete definitions are
registered with the placement command. Stairs, door/frame and window/curtain/
shutter choices update the corresponding defaults with undo support. Existing
objects retain their materials. The sidebar stays visible for every tool except
Tile Mode, which displays its own Layers and Tilesets/Furniture panels.

The **Auto furnish rooms** toolbar button furnishes empty bedrooms, bathrooms and
dining rooms, kitchens and living rooms, including irregular shapes. Choose a coordinated
furniture set across selected rooms, inspect a floor-plan preview, regenerate
with another seed, then Apply. The entire operation supports one-step Undo/Redo.
Occupied rooms are excluded; incomplete layouts require acknowledgement. Planning
checks clearances and connectivity, and Apply rechecks the document and tile availability. See
[the implementation notes](docs/auto-furnishing.md) for APIs, metadata and limits.

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.io/cli) page.
