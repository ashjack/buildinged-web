# Auto furnishing

Implementations 1 and 2 supply room analysis, a curated catalog and a deterministic
placement engine. Implementation 3 connects them to an empty-room furnishing
workflow with room recipes, preview, regeneration and one-step Apply/Undo.
Implementation 4 adds kitchens, living rooms, coordinated native furniture sets
and spatial search for irregular rooms.

## Using auto furnishing (implementation 3)

Click **Auto furnish rooms** (the star beside the furniture tool). The dialog
lists physical rooms across all floors and initially selects eligible rooms on
the current floor. Each room shows its location, floor and eligibility reason.
Empty bedrooms, bathrooms, dining rooms, kitchens and living rooms are supported. Types follow
the room definition's InternalName/name; unsupported/custom types remain excluded.
Room selection does not change those definitions.

Choose **Generate preview** to inspect a numbered top-view layout, furniture
labels and native orientation thumbnails. Entrance/window edges, reservations
and access clearances are visible. Click a room in the list to inspect it.
**Regenerate** advances a seed suffix; the same effective seed reproduces the
same layout. A different seed may yield the same result in a constrained room.
Changing the seed, style or room selection discards the previous preview. No document
objects, UIDs, definitions or history entries are created during preview.

The initial recipes are intentionally small:

| Room | Required | Optional |
| --- | --- | --- |
| Bedroom | One single or double bed | One chair |
| Bathroom | One toilet and one sink | None |
| Dining room | One table and two chairs | None |
| Kitchen | Sink, adjacent counter, cooker and refrigerator | One or two additional counters |
| Living room | Coffee table and sofa facing it | One or two armchairs and a TV facing the sofa |

Bathroom recipes do not include a bath/shower yet. Dining chairs must face the
table along a shared row/column, with footprint distance at most two cells.
The current front-access mask retains one clear cell between a chair and table;
chairs are not forced against a blocked table cell. A chair cannot be proposed
without its table. Recipes use the chosen coordinated furniture set and 55% maximum
blocked-floor coverage. Existing floor holes count toward that coverage.

### Complex layouts and coordinated styles (implementation 4)

The **Style** selector applies to every selected room, across floors. Residential A
uses the original furniture palette; Residential B selects a second explicit native
palette for sofas/armchairs, chairs/tables, counters and sinks. Beds, toilets,
appliances and TVs are neutral shared pieces, marked compatible with both sets.
This is curated asset selection, not image recoloring. A set has no automatic
fallback into the other set when sprites are unavailable: missing pieces remain
visible in incomplete-result diagnostics. Preview remembers its effective style;
Apply reruns that same style against fresh sprite availability.

Kitchen sinks and counters have solid-wall anchors. The first counter must touch
the sink and share its facing. Extra counters extend that same-facing run through
already-proposed extra counters, rather than floating elsewhere. Cookers stay
within three cells of the counter, refrigerators within four cells of the sink;
they may use a different wall to accommodate bends. Related pieces with authored
access cells also need a local walkable connection between their approach cells,
within proximity distance plus two steps. Appliances are floor objects, not
countertop overlays. Required fixtures remain more important than optional worktop
length even though the search explores counters before committing appliance positions.

Living-room coffee tables prefer interior space, with sofas and optional armchairs
facing the table at footprint distance at most two cells. TVs and sofas must face
one another within five cells. Facing follows source cardinal orientations and
requires a straight structural sight line through actual room cells; no sight line
is invented across a wall, window or missing part of an irregular room. A low coffee
table may sit between sofa and TV; other blocking furniture may not. Existing
interaction clearances remain protected. These are editor layout rules, not game
visibility or collision simulation.

Recipes scale optional additions conservatively from available room cells: kitchens
request two extra counters from 50 available cells (one below that); living rooms
request two armchairs from 60 available cells (one below that). These thresholds
do not relax placement or circulation checks, and optional omissions remain partial
results requiring acknowledgement.

Kitchens, living rooms and all nonrectangular regions enable spatial search. A
truncated enumeration budget is shared across catalog roles/orientations and
interleaves origins from a 3-by-3 partition of actual room cells. Candidate windows
and beam branches retain alternatives in other areas as well as high-scoring
choices, so an early corner choice does not consume every branch. Empty parts of
the bounding rectangle never become candidate cells. L/C shapes, courtyards and
rooms joined by narrow necks keep the same exact-membership, floor-hole, entrance,
clearance and connectivity rules. This remains bounded approximate search; a partial
result does not prove that a better layout cannot fit.

These searches use 24,000 candidate checks, 32,000 search checks, beam width 16,
12 branches per state and the same 256-candidate window. Rectangular bedrooms,
bathrooms and dining rooms retain the original search limits.

Empty rooms contain no furniture objects (including rugs), unknown objects or
manual object tiles. Existing furniture is never deleted or replaced. Geometry
that needs review, absent entrances and unsupported room types are excluded.
Stairs and their landings retain their reservations. Missing downloaded sprites
can produce incomplete/empty proposals; download tiles through Tilesets and
refresh/regenerate. The dialog lists unfilled goals and placement diagnostics.

**Apply** adds exactly the previewed objects. Incomplete results require the
visible acknowledgement checkbox, including omissions of optional items. Empty
results cannot be applied. All selected rooms, furniture definitions and new
object UIDs are committed in one document command. **Undo** restores the exact
original document; **Redo** restores the same objects and UIDs. Generated objects
are ordinary native furniture objects and round-trip through TBX export.

Apply reruns the recipes with fresh sprite availability and refuses a changed
layout. Document identity and immutable snapshot checks reject stale previews,
including imported/replaced documents. Refresh the room list after edits.
Cancel/Escape discards previews and cancels pending work before commit. Dialog
keys stay out of the canvas tool shortcuts. Planning yields between rooms;
each individual search still runs synchronously within deterministic work limits.

`AutoFurnishingService.inspect()`, `.generate(session, roomIds, seed, signal?, style?)`
and `.apply(preview, allowPartial?, signal?)` orchestrate the workflow.
`ApplyFurnishing` uses a compare-and-swap snapshot guard and atomically registers
definitions/adds objects through the existing immutable history and render effects.

## Entry points

`AutoFurnishingAnalysisService.prepare(building)` returns a `FurnishingPreparation`:

- `analysis`: physical room regions, structural edges, obstacles and diagnostics.
- `catalog`: versioned furnishing metadata matched to bundled native furniture.
- `availability`: missing downloaded sprites per item and orientation.

The service accepts an explicit document snapshot and does not depend on the
current floor, camera, hidden layers or scene caches. It does not dispatch store
actions. Catalog definitions are loaded once; sprite availability is checked on
every preparation so tilepack downloads/removals are reflected.

The pure function `analyzeFurnishingRooms(building, catalog?)` is usable without
HTTP, IndexedDB or Angular. Without a catalog, existing furniture is treated
conservatively as unclassified.

## Regions and geometry

Regions are connected cells of one room definition on one floor. Explicit walls
and door/window edges split regions even when their room definition is the same.
Different definitions remain separate furnishing zones across open connections.
L-shaped cells are retained; bounding rectangles are descriptive, not placement
areas. EmptyOutside and unassigned cells are excluded.

Each region has a derived ID, zero-based room index, room type suggestion, exact
cell membership, boundaries, windows and entrances. IDs are deterministic for
unchanged membership, but are not persistent UIDs after room edits. Suggestions
prefer InternalName, use known display-name aliases as fallback and leave custom
types unknown. They do not change Room definitions or infer unsupported recipes.

`generateBuildingSquares(building, true)` exposes canonical north/west edges from
the native generator's actual wall and opening passes. None-tile doors still
provide doorways. Windows remain barriers. Last-opening-wins behavior, separate
N/W openings at a corner, wall furniture and border edges follow the generator.
The normal rendering call remains unchanged and does not collect edges.

Doorways and open zone boundaries reserve their inside approach cell. Window
edges are recorded separately. Stairs reserve the five-cell footprint and the
corresponding upper-floor approach zone. Missing floor surfaces, including native
stair holes, are blocked; manual floor repairs are recognized. Stairs themselves
are reserved for furniture without being labelled impassable floor obstacles.
The placement engine uses these regions for navigation and clearance checks.

Existing classified furniture contributes authored blocked cells, access cells
and support surfaces. Rugs are non-blocking. Unclassified furniture uses its
resolved bounding rectangle, including gaps, as a conservative obstacle. Unknown
manual furniture tiles are reserved individually. Structural manual tiles cannot
yet provide trustworthy edge topology and flag the floor for review.

`availableCells` only excludes current reservations; it is not a set of validated
candidate placements. `needsReview` flags unknown room types, missing entrances,
unresolved footprints, invalid stairs/objects and unknown structural manual tile
semantics. The placement engine honors blocking diagnostics and validates complete
footprints, clearances, wall anchors and circulation. A missing furniture definition
cannot safely be handled by reserving its origin alone; its floor requires review.

## Initial catalog

The version-2 catalog has 21 stable IDs, covering single/double beds, sofas,
chairs, dining/coffee tables, armchairs, TVs, toilets, sinks, refrigerators,
cookers, counters and rugs, including the alternate palette. Specifications live in
`utils/furnishing-catalog.ts`. Each includes role, room types, style, weight,
native definition, explicit available cardinal variants, render coverage,
footprint, blocked cells, access cells, wall anchors and support surfaces.

Items match a source group, layer and the W variant's origin tile, never the
group's array index. When native W/N definitions repeat with additional E/S variants, the
complete definition is preferred. Missing or ambiguous matches produce a
diagnostic rather than substituting unrelated furniture. Only source-authored
orientations are supported; images are not rotated to invent variants.

Metadata is conservative editor policy, validated against source definitions.
It is not imported Project Zomboid collision/interaction metadata. Access uses
an authored one-cell front/bed-side strip, with a wall edge for wall-attached
items. Future recipes can add alternative access choices and richer masks.
Counter/table support surfaces are recorded. The engine supports items explicitly
tagged for surface placement, although the initial catalog has no countertop
accessory entries yet.

The native BuildingFurniture parser is shared with the furniture sidebar. Catalog
tests load the actual bundled file to catch stale selectors and variant changes.

## Placement engine (implementation 2)

Pure APIs in `utils/furnishing-placement.ts`:

- `generateFurnishingCandidates(preparation, roomId, options?, placed?, catalogIds?)`
  enumerates valid, scored origins and source orientations, optionally around
  already-proposed placements. It returns work counts and diagnostics.
- `validateFurnishingPlacement(preparation, roomId, input, placed?, options?)`
  returns a canonical proposal or rejection reason codes. Both input and prior
  proposal masks are re-derived from catalog data. Proposal IDs are deterministic
  references, not document UIDs.
- `planFurnishingRoom(preparation, roomId, requests, options?)` searches for a
  layout satisfying explicit goals. There are no implicit bedroom/kitchen recipes.

For example, once a preparation and room ID have been obtained:

```typescript
const plan = planFurnishingRoom(preparation, roomId, [
  { id: 'bed', role: 'bed', count: 1, required: true, priority: 10 },
  { id: 'chair', catalogIds: ['basic.chair'], count: 1, required: false }
], { seed: 'house-42', style: 'basic-residential', maxCoverage: 0.5 });
```

Roles and catalog IDs are intersected when both filters are supplied. Counts are
for new objects only; existing objects are preserved, not counted against goals.
`required` defaults to true; priority defaults to 1. A room-type override can
resolve an unknown type, but does not bypass geometry or obstacle review flags.
Requests may include `near: { requestId, maxDistance, faceTarget?, targetFacesCandidate?, sameFacing?, extendRun? }` for recipe
relationships. Dependencies are processed before dependents, even when priority
or input order differs. Missing/cyclic references and invalid distances are
rejected. Facing requires native front-axis alignment and access closer to the
target; proximity does not bypass the ordinary placement/clearance rules.
An optional non-negative integer `order` controls exploration order before priority,
without changing the objective's preference for fulfilled required goals. Dependencies
still come first. `extendRun` lets repeated placements connect to earlier placements
of the same request as well as to the named anchor request.

`AutoFurnishingPlacementService.plan(building, rooms, options?)` prepares a document
once and plans each requested room independently, with optional per-room options.
Duplicate room requests are rejected. Room ordering does not change plans, and
planning one room alone produces the same result as including it in a building
operation with the same options. No store actions, definition registration or
object UID allocation occur.

### Geometry, clearances and connectivity

Candidates must fit exact room membership and may not straddle a wall or opening.
Wall anchors require solid wall edges, not windows or doors. Entrances, unknown
obstacles, missing floors and stairs/landing zones retain their reservations.
Interaction clearance cannot use a stair tread or landing as a standing cell.
Clearances must meet the furniture through an open edge and be reachable from
a room entrance. Previously reachable access to existing furniture is preserved.

Same-layer object overlaps are refused. Non-blocking FloorFurniture rugs may lie
beneath Furniture objects, and a surface item may overlap its complete supporting
surface. A surface item needs one existing or proposed host covering its whole
footprint; bridging incomplete hosts is not supported. Surface items must not
add floor-blocking cells. Support proposals are processed before surface goals.

Navigation uses cardinal steps through the native edge map, permitting doorways
and open edges and blocking walls/windows. After adding furniture, each original
walkable component must remain connected among its surviving cells. The engine
therefore rejects new isolated floor pockets as well as blocked entrance routes.
Pre-existing disconnected areas need not be repaired, but new blocking furniture
and new access cells must be in entrance-reachable space. No passage is invented
through a wall to satisfy a goal.

Checks are room-local and preserve door/stair approaches; they do not simulate
door swings, avatar width, game collision flags or vertical stair traversal.
Circulation currently requires a one-cell path. Richer access policies and more
complex furniture relationships belong in later metadata/recipes.

### Scoring and deterministic search

Every proposal exposes wall-placement preference (0–20 in `wallAffinity`, favoring
interior space for coffee tables), distance-from-entrances (0–12),
circulation (0–12, penalizing added dead ends), style consistency (0 or 20), and
remaining free space (0–10). Total score is their sum. Coverage limits count
existing and new blocked cells, including floor holes; the default is 1.0.

Bounded beam search orders results by fulfilled required count, required
priority, optional priority, total object count, then layout quality. Required
objects cannot be traded for optional ones. When all required objects cannot
fit, this objective favors the number fulfilled before priority; priority is
not an absolute guarantee for a particular individual goal.

Seed-derived, catalog-weighted tie-breaking varies otherwise equivalent choices.
The same preparation, requests, seed and options produce the same plan, regardless
of catalog, availability, cell or room-request ordering. Different seeds affect
ties; they do not make invalid placements eligible. Skip branches permit bounded
backtracking rather than committing every early choice greedily.

Defaults: 12,000 candidate checks, 20,000 search checks, beam width 12, eight
branches per state, and a 256-candidate window per state. Regions are limited to
4096 cells and operations to 64 requested placements per room. All limits are
deterministic; no wall-clock timeout affects reproducibility. Search limits are
configurable within validated bounds, but room/placement caps remain fixed.

Results are `complete`, `partial` or `blocked`, with unfilled counts,
`requiredSatisfied`, score components, diagnostics and work statistics. Work-budget
exhaustion sets `stats.truncated`; already-valid proposals remain available.
Beam/window limits make this an approximate search, not proof that a better
arrangement cannot exist. A complete result means the requested counts were
met, not that a global optimum was found. Optional omissions still produce a
partial result, with `requiredSatisfied: true` when appropriate.

## Remaining phases

Richer furniture sets, furnishing occupied rooms, persistent generator ownership,
replacement/regeneration of already-applied layouts and advanced density controls
remain future work. To change an applied layout
in this release, Undo first, then reopen and regenerate the now-empty rooms.
