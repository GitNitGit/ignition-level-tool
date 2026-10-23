# Ignition Level Editor – user manual

The level editor builds new race tracks for *Ignition* (1997) in the browser and compiles them into the game's own
level files. You draw the track as a line of control points, let the editor generate a landscape around it, shape and
paint that landscape, place objects, sounds and animations, and finally compile the level and install it into the game
in place of one of the original levels.

The game's file format is described in [LEVELFORMAT.md](LEVELFORMAT.md). You do not need to know it to use the
editor, but the chapters referenced below explain *why* the editor does certain things.

## Contents

- [Getting started](#getting-started)
- [Principles](#principles)
- [The screen](#the-screen)
- [Track](#track) (tab 1)
- [Landscape](#landscape) (tab 2)
- [Paint](#paint) (tab 3)
- [Assets](#assets) (tab 4)
- [Sounds](#sounds) (tab 5)
- [Animation](#animation) (tab 6)
- [Deployment](#deployment) (tab 7)
- [File](#file) (tab 8)
- [Controls](#controls)
- [Data model](#data-model)
- [Compile rules](#compile-rules)
- [Tests](#tests)
- [Known limits and open questions](#known-limits-and-open-questions)

## Getting started

**Requirements:** Node.js 18 or newer and an installed copy of *Ignition*. Nothing else: the tool has no packages to
install and uses no CDN (three.js is shipped in `editor/public/vendor/`).

**Start:**

- `editor.bat` starts the editor on <http://localhost:8767/> and opens it in the browser.
- `viewer.bat` starts only the 3D viewer for the original levels on <http://localhost:8765/>.

Both run `node editor/server.js`; on other systems run that directly. Options: `--viewer` (viewer only),
`--port <n>` (another port, e.g. when the default is taken), `--no-open` (do not open the browser).

**Game directory:** the server looks for the game in the Steam library. If it is not found, the browser shows a setup
page where you type or browse to the game folder; the choice is stored in `data/config.json`. You can change it later
in the [Deployment](#deployment) tab ("change").

**Where your work lives:** everything you make is inside the tool's `data/` folder.

| Path | Content |
|---|---|
| `data/levels/<name>/level.json` | the level itself (the source of everything) |
| `data/levels/<name>/sound/` | the level's own sounds, already converted to the game's format |
| `data/levels/<name>/ref_<view>.png` / `.jpg` | reference images of the Top, Front and Left views |
| `data/textures/*.png` | your own textures, shared by all levels; new or changed files are picked up within two seconds |
| `data/out/<name>/<SLOT>/` | the compiled level (the folder that goes into the game's `LEVELS` directory) |
| `data/out/<name>.zip` | the same as a zip |
| `data/config.json` | the game directory and the default slot |

**A first level:** open the [File](#file) tab, type a name and press **New**. The level starts as a circle of 8
control points. Shape the track in the [Track](#track) tab, press **Generate terrain** in the [Landscape](#landscape)
tab, then **Compile** and **Install into the game …** in the [Deployment](#deployment) tab, start the game and choose
the replaced level (Canada by default).

## Principles

- **`level.json` is the source, the game files are compiled.** You never edit game files. Every change is made to the
  level, and the compiler builds the game's meshes, placements, gates, collision index, palette and textures from it
  each time you compile. Anything the game cannot take (too long edges, too many placements, overly wide sections) is
  fixed or reported by the compiler without touching what you drew.
- **One level at a time.** The editor works on one level directory; switch levels in the [File](#file) tab.
- **Little magic.** The track is parametric (control points with widths and settings). The landscape is generated
  **once** and from then on stored as explicit **points and triangles** that you edit directly; it is never regenerated
  behind your back. When the track changes, the landscape is adapted locally (see
  [Changing the track keeps the landscape](#changing-the-track-keeps-the-landscape)).
- **The tabs follow the steps of building a level:** Track → Landscape → Paint → Assets → Sounds → Animation →
  Deployment.
- **Slot:** a custom level replaces one of the original level folders of the game, Canada by default (`slot` in
  `level.json`). The editor copies some files that it does not generate (effect tiles, preview picture, weather sounds)
  from the original level named in `source`.
- **Plain colours.** Until you paint them, faces show the default colour of their material: road grey, kerbs blue,
  drivable ground brown, landscape (not drivable) green, deadly ground red, slippery road bluish grey, "deadly in wrong
  order" road reddish grey, bridge deck dark grey.

## The screen

- **Header:** the level name (with "unsaved" when there are unsaved changes) and the eight tabs. Keys 1–8 switch tabs,
  Tab / Shift+Tab step through them.
- **Tools panel (left):** the controls of the current tab. It widens for the asset library.
- **Warnings / Info panel:** *Warnings* lists the checks of the compiler – errors (red, the level cannot be compiled),
  warnings (orange) and notes (yellow); a click on an underlined entry centres the views there. *Info* shows statistics
  (sections, placements, triangles, expected lap time …). Below it is a summary of the selection.
- **Four views:** Top, Left, Front and 3D. Drag the dividers to resize them; the button in a view's head maximises it
  (and back to four views). The heads of the flat views also hold the landscape view tools (see
  [Landscape](#landscape)).
- **View bar:** *Solid* / *Wireframe*; *By surface type* (material colours) / *Textured* (the painted colours with the
  baked light, as the game will show them); **Reset view** (frames everything; F frames the selection); **Ruler (R)**;
  **Reference**; **?** (F1: describes what is under the mouse – points, faces, sections, objects).
- **Ruler:** with R (or the box) on, drag anywhere to measure. The label shows the distance, the flat distance and the
  height difference in world units. The measurement stays until the next one; Esc clears it.
- **Reference image:** the **Reference** popover lays a PNG or JPEG on the plane of the Top, Front or Left view (one
  per view) as a guide while building – a sketch, a map, a photo. Settings: ON / OFF, opacity, width in world units,
  rotation, shift right / up, Remove. It is drawn over everything, faded. Editor only: the compiler ignores it. The file
  is stored beside the level (`ref_<view>.png|jpg`).

Units: the game's world units. For scale, a road is typically 300–400 wide, a track section is at most 250 long, and
the game shows about 4600 units ahead.

## Track

Tab 1 edits the track: control points, road sections and their settings, kerbs, markings and crossings. The road,
kerbs and verge (together: **the base**) are built from these at once.

The track is **one closed main loop** plus optional **branches**: a branch leaves the loop at a *fork* and rejoins it
at a *merge*. The **start** is a control point of the main loop; the driving direction can be reversed.

The tab has two pick modes, **Points** and **Sections**; Space switches between them.

### Control points (Points)

- **Select:** click a point (Shift adds, Ctrl toggles), or drag a box on empty space.
- **Move:** drag a selected point in any view (a click on an unselected point only selects it), or use the arrow keys
  in the view under the mouse (Shift ×5, Ctrl snaps to 100); PgUp / PgDn change the height.
- **Insert:** double-click near the track (Top or 3D view).
- **Delete:** Del.
- **Control point** box (one point selected): position, **Track width**, **Verge width** left / right (the drivable
  strip beside the road, left / right in driving direction; 0 = none). Widths are interpolated along the track between
  the points.
- **Tangents** – how the road runs through the point:
  - *Auto*: a smooth automatic curve (Catmull-Rom).
  - *Linked*: two handles appear at the point; drag them in any view. Both stay on one line through the point.
  - *Separated*: as Linked, but each handle moves on its own.
  - *Corner*: the road runs straight into and out of the point – a sharp bend. The road surface is not mitred there
    yet: the inner side overlaps, and the gate of a branch leaving at a corner can get short.

  The handles start from the automatic tangents, so switching mode does not make the track jump.
- With **two points** selected:
  - **Jump** (two neighbouring points): a gap without road between them. See [Jumps](#jumps).
  - **Branch** (two points of the main loop): a new branch between them. Selecting the two ends of an existing branch
    and pressing Branch removes the branch with its points.

  Both buttons are toggles that show the current state.
- **Set start** (one point of the main loop): the start / finish line. **Reverse direction** reverses the driving
  direction.

### Road sections (Sections)

The track is cut into **sections** of at most 250 units (see [Compile rules](#compile-rules)). In Sections mode you
select them: click (Shift selects the range along the track from the last clicked section – across forks and merges
the shorter way round –, Ctrl toggles, a box selects the sections whose middle lies in it).

The buttons are toggles that show the state of the selection (on when every selected section has it):

- **Kerb left / Kerb right**: kerbs along the road edge.
- **Verge left / Verge right**: off, the strip beside the road is landscape (not drivable, green, acts as a wall)
  instead of drivable ground. The strip itself stays, so the terrain keeps its shape.
- **Terrain**: off, the sections have no landscape of their own (see [No terrain](#no-terrain)).
- **Slippery**: slippery road (surface code 5).
- **Deadly if wrong order**: the road is deadly when it is reached outside the gate order (code 20) – against
  shortcuts and to make short jumps compulsory. Its verge counts too (code 21: landing beside the road).
- **Ramp (lift off)**: ramp road (code 10). The edge from this road to not drivable or deadly ground can be left
  instead of acting as a wall – as the road before a jump, or at the edge of a cliff (tested in the game: the car falls
  off there).
- **Camera** slider (−500 … +500 in steps of 50, 0 = none): the game moves its camera by this while a car is on the
  section. Which direction is which is still to be tried out (the Carib level uses this before its U-turn).
- **Sign**: the warning sign the game shows while a car is on the section. *Auto* uses the automatic signs: before
  bends (by their total turn and side), jumps, forks and drops (ramp sections), on about 6 sections, as measured in the
  original levels. The others set it by hand and win over the automatic one: 1 slight left bend, 2 slight right bend,
  3 left bend, 4 right bend, 5 sharp left, 6 sharp right, 7 U-turn, 8 U-turn other side, 9 jump, 10 fork,
  11 / 12 chicane, 13 warning (!), 14 crest, 15 drop.

### Kerbs and road markings

- **Kerbs → Profile:** top width, foot width (from the road edge outwards) and height, for all kerbs of the level.
  Default: top 80, foot 140, height 30 (evenly sloped sides). The profile is stored per level, so older levels keep
  theirs.
- **Colours:** default colours of the kerb's inner side, top and outer side. Paint overrides them.
- **Centre line:** none / solid / dashed (16 wide). Edge lines (16 wide, 15 inside the road edge) can be switched on in
  `level.json` (`track.marking.edges`). Markings are their own rows of the road, so they can be painted like any other
  triangle; their surface code is that of the road around them. Note: road markings are not yet reliable in the game
  (see [Known limits](#known-limits-and-open-questions)).

### The base: road, kerbs, verge

The base is built from the track at once and is not stored: the **road** (two halves, split at the centre line), the
**kerbs** and the **verge** (drivable ground beside the road). Its outermost row is where the landscape attaches.

In a tight bend the inner rows (kerb edges, verge) would cross themselves. Each row is therefore **cut where it
crosses itself** (like a trimmed offset line): the strips there become fans of triangles, and kerb and verge continue
through the bend. Whatever still turns over or overlaps something built before it (the road first, then kerbs, then
verge) is left out and the landscape fills it. The road itself is never changed.

A level without terrain compiles as it is: road, kerbs and verge, no walls.

### Branches and junctions

Where a branch leaves or rejoins the main loop, or wherever two roads or their verges overlap, the editor builds a
**junction zone**: one continuous surface instead of separate strips, with the centre line of the branch splitting off
the main road's and the edge lines following the outline of the joined road. The heights of both roads are blended
smoothly in the zone (see [Compile rules](#compile-rules) → Junctions). More than 20 % cross slope on the road gives a
warning – even out the heights of the control points.

Kerbs currently stop before a junction zone (they end with their caps at its border).

### Jumps

A segment marked **Jump** has no road. Setting a jump in the Track tab changes no landscape: only the gap itself (where
road, kerbs and verge would be) is filled flat at road height with deadly ground, and taking the jump out again removes
exactly that fill. **Generate terrain** sinks a deadly pit ("Jump pit" depth) under a gap.

The road of the 2 sections before and after a gap automatically gets the ramp code, so the car can lift off. The
take-off and landing sections are paired for the game's track order (see [Compile rules](#compile-rules) → Numbering).

### Crossings: tunnels and bridges

Where the track crosses itself, the crossing needs a height clearance of at least 250, otherwise it is an error. The
**Crossings** list shows every crossing (the upper and the lower segment; a click centres the views) with a choice:

- **tunnel** – an underpass: the upper road lies in the landscape as everywhere, the lower road passes under it. The
  editor builds the floor of the underpass (the lower road), tunnel walls on the lower road's outer rows up to a
  ceiling 60 under the upper road, a fascia closing the deck at both mouths, and closes the corners where the
  landscape climbs from the mouth to the upper road. Both roads keep road, kerbs and verge.
- **bridge** – a free-standing deck: the landscape does not climb to the upper road but stays down and runs on under
  it; the lower road stays whole. The upper road becomes a box: the road on top, an underside 60 below, a fascia along
  both edges, open sides. A car can leave the deck there (it is all ramp-coded, as is the cliff under the deck's ends;
  tested in the game: the car falls off and can cut across below, as in the originals). Where the lower road passes
  right under a deck's end, the editor closes the upright face from the deck's end down to the ground.
- **none** – nothing is built: the upper road floats over the crossing, the lower road stays whole. With terrain the
  landscape stays at the lower road and rises to the upper road's ends.

Without a choice the mode is automatic ("(auto)" in the list): *none* where either road has no terrain, *bridge* where
the upper road has no verge over the crossing, else *tunnel*. Inserting a point into one of the two segments makes it
a new crossing, and the choice falls back to automatic.

A branch passing under or over the main road is not swallowed by it; roads only join at the same height.

### No terrain

With **Terrain** off, the selected sections have no verge and are not part of the landscape's outline: the landscape
runs on under the road at the height of the land around – a track in the air (its kerbs stay). It works on generation
and when switched later (the landscape adapts).

### Changing the track keeps the landscape

Once the landscape exists, every track change – moving, height, width, verge, new or deleted points, branches, jumps –
keeps it and adapts it locally:

- **Settings follow the road.** Kerbs, slippery, order, ramp, verge, signs and base paint are stored per segment by
  position along it, so they stay in place when a segment is split by a new point or merged by a deleted one.
- **Section counts are frozen** per segment once the terrain exists (the terrain refers to them); a segment is cut
  afresh only when it gets too long for its count.
- **Push:** the landscape near the road moves with the base's outer row – fully up to 300 from the road, then less and
  less, so neighbouring points follow in proportion and nothing folds. The push fades out towards the outer wall,
  which stays.
- **Re-made only where needed:** triangles at outer-row points that no longer exist, triangles the road now lies on,
  turned-over or overlapping triangles, and points pushed onto the base. The hole is filled by a fresh triangulation
  between base and remaining terrain; new triangles take material and colour from the nearest removed one. Holes you
  made yourself (deleted triangles, cut-loose objects) and placed objects are left as they are. Landscape that lay over
  a road on purpose before the change (the ground under a bridge deck, the cliff under its ends) stays.
- **While dragging** only the ground is rebuilt and the terrain is not adapted (its attached points follow, the rest
  waits); on release the terrain is adapted from its state at the start of the drag and everything is rebuilt. The
  same change always gives the same terrain.
- After the first change the landscape points are free (absolute); only the points on the base stay attached to it.
- Limit: where the base overlaps itself (very tight hairpins, branches leaving at a sharp angle) there are holes – the
  same as with "Generate terrain".

## Landscape

Tab 2 creates and edits the terrain – explicit points and triangles. Pick mode **Points** or **Triangles** (Space
switches).

### Generating

Before the first generation the tab shows the parameters:

| Field | Meaning |
|---|---|
| Wall band | the band of wall (not drivable landscape) beyond the drivable verge before the coarse grid starts |
| Grid cell | spacing of the outer grid (coarse like the originals: 1500) |
| Margin | how far the terrain reaches beyond the track's outline |
| Jump pit | depth of the deadly valley under a jump gap |
| Outer wall | height of the wall around the terrain |
| Max edge | longer terrain edges are split |

**Generate terrain** builds the landscape once: a triangulation of the base's outer row, a ring beyond it (the wall
band), deadly pit edges under jumps, the coarse grid further out and the outer wall. It also freezes the number of
sections per segment. **Generate again …** throws the terrain away and builds it anew; **Remove the terrain …** deletes
it.

The base's outer row (and kerb rows where the terrain meets a kerb) is **locked**: it belongs to the track, so base
and terrain always meet without cracks. These points are shown in blue; they can be picked (to make triangles or fill)
but not moved. Generated points are attached to the track; **Free points** detaches the selected ones, so they stay
where they are when the track moves.

### Editing

- **Points:** click, Shift, Ctrl, box as everywhere. Move them in any view, with the arrow keys, or set the **Height**
  field.
- **Split in 3:** each selected triangle into three around a new middle point.
- **Split in 4:** a new point in the middle of every side – three corner triangles and a middle one; neighbours that
  share a cut side are cut too, so no point hangs on a side (sides on the base's outer row are not cut).
- **Split edge / Flip edge:** for two triangles sharing an edge – a new point in its middle, or swap the diagonal.
- **Delete triangles** (Del in triangle mode): removes them and the free points only they used. **Delete points**
  (Del in point mode): removes the points with every triangle using them (the road's outer row stays).
- **Add triangle:** between three selected points.
- **Fill with triangles:** triangulates the selected points (also of the road's outer row) in plan and makes triangles
  only where there is no landscape and no base yet; material and colour come from the neighbours.
- **Copy / Paste** (Ctrl+C / Ctrl+V): copies the selected triangles (in point mode those whose corners are all
  selected) with material and paint; pasted at the mouse in the view under it (flat views keep the depth, 3D the
  height), as free selected points – a floating piece until you join it to the landscape with Fill.
- **Triangles → points:** selects the corners of the selected triangles.
- **Cut loose (object):** the selected triangles become a separate object, not part of the landscape (drawn tinted).
  Landscape that is not connected to anything attached to the track is such an object too.
- **Remove unused points:** points no triangle uses.

**View tools** in the heads of the Top, Front and Left views (while points are selected):

- *Align horizontally / vertically*: all selected points on one line of that view, through the point clicked last
  (yellow ring).
- *Move / Rotate*: what dragging a selected point does; Rotate turns the selection about the point clicked last, in the
  view's plane.
- *To ground*: one height shift so the selection's border meets the points around it as well as possible.

### Materials

The material of the selected triangles; new triangles use the last one pressed.

| Material | Colour | In the game |
|---|---|---|
| Landscape | green | not drivable, acts as a wall |
| Drivable | brown | drivable ground |
| Deadly | red | the car explodes |
| Drop edge | ochre | drivable with ramp behaviour (code 11) |

The edge from drivable to not drivable ground acts as a wall in the game unless the drivable side is a ramp – as at
jump take-offs. For a cliff the car can fall off, put a row of **Drop edge** between the road and the drop (tested in
the game).

### Holes

Open edges – between terrain and base or between terrain triangles – are drawn as red ribbons and listed in the
Warnings. An edge counts as closed when faces on its other side cover it along its whole length, even without shared
points. The outer border of the landscape is not a hole, nor is any border where you deleted triangles at the outside;
a hole has its empty side inside.

## Paint

Tab 3 gives every triangle – road, markings, kerbs, verge, bridge deck and landscape – **one paint**: a colour or one
of your textures. Painting changes the colour only, never the material (the surface code).

**Paint with:**

- **Colour:** the colour picker and recently used colours.
- **Texture:** a PNG from `data/textures/` (a file saved there shows within two seconds), its **Size** (the world
  units one repeat of the image covers – its width; the height follows the image's proportions) and its **Mapping**:
  - *Auto*: projected along the face's main direction (from above onto flat ground, from the side onto walls), so
    neighbouring faces continue seamlessly.
  - *Along the road*: across and along the road (image up = driving direction, centre line = image centre); for road,
    kerbs and verge – landscape faces fall back to Auto.
  - *From above / From the front (along z) / From the side (along x)*: a fixed projection.

  Texture coordinates follow from the face's position alone, so the paint survives re-cutting and terrain edits like a
  colour. Transparent pixels are see-through in the editor and in the game: a road painted with a fully transparent
  image is invisible but drivable.

**Tools:** **Click** (one triangle), **Brush** (all visible triangles touched by the circle; one undo step per stroke;
size slider), **Fill** (all connected triangles painted the same), **Pick** (I, or Alt+click with any tool: takes a
face's colour or texture, then returns to the previous tool). **Erase** paints the material's own colour back.

Mind the triangle count with textures: the compiler cuts every textured face into pieces of one 64×64 tile each, so a
landscape triangle 2000 across painted with a 128-unit repeat becomes some 250 pieces. Use large sizes on the
landscape. There is also a budget of tiles (see [Compile rules](#compile-rules) → Palette and texture); faces whose
tile does not fit show the image's mean colour.

Base paint is stored by section range, strip and triangle, so it stays when the track is moved or re-cut. The terrain
operations (split, flip, copy, …) keep the paint.

The game does not light anything, so the compiler bakes light into the colours (see [Compile rules](#compile-rules)).
The *Textured* view shows the result.

## Assets

Tab 4 places objects: objects of the original levels and your own assets.

### The library

The **source** selector chooses an original level of the game directory, or **Custom** (this level's own assets).
The library shows a card with a rendered preview for every object.

The original levels' objects include their object placements (signs, pylons, cones, some houses and rocks) and the
objects that are part of their landscape meshes – most trees, bushes, huts and rocks of the originals are groups of
faces inside the track sections' meshes. **Every distinct object is listed once** with the number of its copies (×n);
the originals scale and turn their copies a little, which is ignored here.

Objects keep their original textures (tiles of the original level's texture); "By surface type" in the view bar shows
their flat colours. Once a slot is installed, the library reads the original level from the `<slot>.org` copy.

### Placing objects

- **Drag a card into a view:** the object lands on the ground under the cursor. A double-click on a card puts it at the
  centre of the view under the mouse.
- **Select** placed objects by their faces or marker, Shift / Ctrl / box as usual. **Drag** them by their faces in any
  view (3D: along the ground), or use the arrow keys. **Ctrl+drag** drags a copy (Ctrl+click without a drag toggles
  the selection).
- **Gizmo** at the selection: arrows move along an axis, rings rotate about it, cubes scale along it (the centre cube
  scales uniformly). In the 3D view the gizmo uses the selected object's own axes; in the flat views it uses the world
  axes in the view's plane. Ctrl snaps (10 units, 15°, 0.1 of scale); Ctrl+drag on an arrow copies the selection and
  moves the copies along that axis.

**Object box** (with an object selected): position, rotation (degrees about x, y, z, x first) and scale per axis, and:

- **Collision** – what happens when the car touches the object:
  - *OFF (drawn only)*: no collision.
  - *Solid (part of the landscape)*: the object's faces become part of the nearest track section, with walls, ground
    and surface codes (own assets: the surface of each body; originals: wall). Solid objects cannot be animated.
  - *Hits the car*: the reactions of the originals' vehicles and rolling objects – rams it (train, hovercraft, truck),
    blows it up (USA lorry), flattens it (rolling stones), knocks it (Austria snowballs), throws it up (like a geyser).
    Works for standing and animated objects (tested in the game).
  - *Kicked away* (light / heavy / very heavy): the car knocks the object away like the originals' cones. The game's
    hit box is about 60 × 60 around the object's point, whatever its size.

  A placed original cone or pylon brings its own setting.
- **Warning light ON / OFF:** the game flashes a white-yellow light 20 above the object's point, in a chaser over all
  such objects (like the pylons of Canada, Carib and Japan); the car kicks it away like a light cone. The colour cannot
  be set. A placed original pylon flashes by itself. Switches Collision off.
- **Duplicate**, **Drop to ground** (lets the selected objects fall until a face touches the ground, the road or
  another object), **Reset** (rotation 0, scale 1), **Delete** (Del).

Faces of a placed object that lie completely under the ground are dropped when compiling (the bottom of a box sunk
into the ground), except under bridges and in tunnels.

### Own assets (Custom)

**New …** opens the **asset editor**; **Edit …** reopens the chosen own asset. The level stays visible but frozen,
and the asset sits at one of its placed copies or on the ground in the middle of the view.

An asset is built from **bodies** – box, sphere, cylinder, cone, pyramid, tetrahedron, plane – combined **in their
order** by union, subtraction or intersection into one closed low-poly mesh. A plane is laid on top without combining
(double-sided).

- **Add** a body of the chosen kind. Select bodies by clicking a face or their centre marker, or in the list
  (outliner: click, Ctrl toggles, Shift selects a range). Drag them by their faces, copy with Ctrl+drag, move them with
  the gizmo (the body's own axes in 3D), the arrow keys or the fields.
- **Union / Subtract / Intersect** with two or more bodies selected: the first in the list is the base, the others get
  the operation and move right behind it. A body's operation can also be set in its properties; the outliner shows it as
  a badge (+ − ∩).
- **▲ / ▼** change the order of combination; **⧉** duplicates; **Delete** (Del).
- **Group / Ungroup:** folders in the outliner (a click on the group row selects its bodies, the arrow folds it,
  double-click renames). Groups do not change the order of combination. Bodies and groups can be named (Name field,
  double-click on the row, or F2).
- **Body** properties: name, group, kind, operation, segments (sides of a sphere, cylinder or cone, 3–24), colour and
  **Surface** (what its faces do when the placed object is *Solid*: wall, drivable ground, road, ramp, slippery road,
  deadly).
- **Faces:** with **Paint faces** on, a click gives one face of a body the colour beside; it stays on every fragment
  of that face after combining. **Paint body** gives all faces of the selected bodies that colour; **Clear** returns
  to the body's own colour.
- **Gizmo: Bodies / Origin:** Origin moves the asset's origin (its placement point and the point it turns about, the
  yellow marker) while the bodies and the placed copies stay where they are. **Origin to bottom centre** puts it under
  the middle of the bodies' box.
- **Done** keeps the asset (its bodies are stored, so it can be edited again); **Cancel** restores the state before.
  Undo works inside the asset editor. A new asset leaves its first copy where it was built.

### Textures on own assets

A body gets an image from `data/textures/` (PNG, 8 bit, not interlaced) through a **projector frame**: a rectangle
through which the image is projected onto the body's faces; beyond it the image repeats.

- **Fit front / Fit top / Fit side** put the frame on a side of the body, as large as it. **✕** removes the texture.
- **Place texture** on: the gizmo and the fields Position / Rotation / Repeat (width and height of one repeat in world
  units) move the selected body's frame, drawn as a translucent image with a yellow outline. Off: the frame is hidden
  and the texture is fixed to the body – it moves, turns and scales with it, and a copy carries it.

**Transparency:** fully transparent pixels become see-through in the game. Tiles with holes (alpha only 0 or 255, soft
edges allowed) need one of the few tile numbers the game draws see-through in the chosen slot (Canada 20, USA 24,
Carib 11, Brazil 4, Iceland 8, Austria 1, Japan 3 – tested in the game for Canada and Japan objects); the compiler
assigns them. Tiles with real partial transparency (more than a quarter of their visible pixels between 0 and 255) are
drawn 50 % blended. Tiles with holes beyond the slot's numbers fall back to blending, with a warning.

**Animated textures:** a PNG named `<name>_anim.png`, n × 64 pixels wide and 64 high, is a strip of n frames (at least
2) of one tile. Use it like any texture, on a body or with the Paint tab. In the editor the strip shows as it is; in
the game every 64-pixel cell of the texture shows the frames one after another, about 13 per second, so every face
with the texture blinks in step (for example a stage with coloured lamps). Each frame takes one tile of the texture
budget. Tested in the game.

## Sounds

Tab 5 adds the level's own ambient sounds.

- **Add sounds** with the file chooser: any PCM WAV (8 / 16 / 24 / 32 bit integer or float, any channels, any rate).
  The server converts it to the game's format – 8 bit unsigned mono 11025 Hz – and keeps it in
  `data/levels/<name>/sound/`.
- **The list** shows every sound with its length, a **gain** in per cent (applied when compiling, clipped), the file
  name it gets in the level, and ▶ to listen (looped, as the game plays ambient sounds). The **Name** field renames it.
- **Sources:** drag a sound from the list into a view – a source (yellow marker, 50 above the ground) plays it there.
  Sources are selected, box-selected, dragged and moved with the arrow keys like control points; Del removes them.
- **Rides on:** a source can ride on a placed object; its offset to the object stays, and when the object is animated
  the sound moves with it. Deleting the object leaves the source where it was.

**How the game plays sounds:**

- Every sound file of the level has a slot number. Own sounds get slots 3–13 in the order of the list (at most 11 own
  sounds); slots 0–2 stay for the slot's weather sounds (Canada: rain, thunder, lightning). The original sound files
  keep their slots where no own sound takes them.
- All sounds loop. One-shot sounds are not supported yet.
- **Loudness and reach:** the game sets a source's volume each frame by the horizontal distance d to the car:
  0.75 × (1500 − d) / 1500 of the sample's level. One source is therefore heard within 1500 units only (3000 across)
  and comes in abruptly; nothing in the level changes that. For louder or longer sounds use **more sources of the same
  sound**: stacked at one point they add up; spaced 500–800 apart along a stretch they make an even carpet with a
  1500 fade at both ends (the originals do both).

## Animation

Tab 6 moves placed objects along keyframes.

- **New** creates an animation, the selector picks one, 🗑 deletes it. An animation has a **Name**, a **Length** in
  seconds (the game restarts every path hard after its last frame) and its objects.
- **Add selected:** the objects selected in the views join the animation with a key at 0 s (their placement).
  **Remove** takes them out (their keys go, the placement stays). An object belongs to at most one animation; *Solid*
  objects cannot move and are refused.
- **The timeline** under the views shows a time ruler, a track per object with its keys as diamonds, and the playhead.
  Drag on the ruler or a track to scrub; **▶** plays at the game's rate and wraps at the length.
- **Making keys:** move or turn the selected object with the gizmo or by dragging it (no scaling in animations). With
  **Auto-key** on, the pose becomes a key at the playhead at once; otherwise **◆ Key** makes keys of the selected
  objects' poses. Drag keys in time; **✕** or Del deletes the selected key (the key at 0 s stays; Del without a key
  removes the selected objects from the animation).
- Between keys the pose is interpolated linearly (angles the shortest way); before the first key the first holds, after
  the last the last. The game moves the object straight from the last frame back to the first.
- The frame rate is assumed to be 25 per second (still to be measured in the game). All animations start with the
  level; ease in / out and delayed starts are not supported.

The viewer plays the animations too ("Move objects").

## Deployment

Tab 7 builds the game files.

- **Compile (write files + zip)** writes `data/out/<name>/<SLOT>/` and `data/out/<name>.zip` and shows the compiler's
  report in the Warnings panel. A level with errors is not written.
- **Install into the game …** asks for confirmation, then replaces the slot folder (`LEVELS\<slot>` in the game
  directory) with the compiled level. The original folder is kept as `<slot>.org` the first time; later installs
  replace only the slot folder. To restore the original, delete the slot folder and rename `<slot>.org` back.
- **download zip ↓** downloads the compiled zip (its content goes into the game's `LEVELS` folder). It always
  contains files of the original slot level (preview picture, sounds, effect colours, colour tables), and the
  objects placed from the original levels. To pass a level on, share its source instead: the folder
  `data/levels/<name>/` and the PNGs it uses (see "Sharing levels" in the README).
- **Show in viewer ↗** sends the current level – saved or not – to the viewer, where it appears as
  "<name> (editor)" beside the original levels. The viewer can also download any level as OBJ (zip) for Blender and
  other 3D programs.
- **Target:** the slot that will be replaced and the game directory; **change** opens the setup page to choose another
  game directory.

The slot itself is set in `level.json` (`slot`, default Canada); `source` names the original level the copied files
come from.

## File

Tab 8: the level selector, **Save** (Ctrl+S), **Undo** (Ctrl+Z) and **Redo** (Ctrl+Y, 100 steps), and **New** /
**Save as** with the name typed beside them. Levels are stored in `data/levels/<name>/`.

## Controls

| Action | Input |
|---|---|
| Switch tab | 1–8; Tab / Shift+Tab |
| Points / sections (Track), points / triangles (Landscape) | Space switches the pick mode |
| Select | click (Shift adds, Ctrl toggles); drag on empty space: box |
| Clear selection (and the ruler) | Esc |
| Move selection | drag a selected item (a click on an unselected one only selects it); arrow keys in the view under the mouse (Shift ×5, Ctrl snaps to 100); PgUp / PgDn height |
| Tangent handles (Track) | a selected point with tangent mode Linked / Separated shows its two handles: drag them (the selection stays) |
| Jump / Branch (Track) | toggles for two selected points |
| Insert control point | double-click near the track (Top or 3D view, Track tab) |
| Delete | Del (control points; triangles or points with their triangles; objects; bodies; sound sources; animation keys) |
| Copy / paste landscape | Ctrl+C / Ctrl+V (pasted at the mouse) |
| Objects and bodies | click a face or marker selects; drag moves (3D: along the ground); Ctrl+drag copies; gizmo: arrows move, rings rotate, cubes scale, Ctrl snaps, Ctrl+drag on an arrow copies along that axis; 3D = the object's own axes, flat views = world axes in the view's plane |
| Rename body (asset editor) | F2 or double-click in the outliner |
| Paint | click / drag with the brush; Alt+click takes the colour or texture; I: the Pick tool |
| Sounds | drag a sound from the list into a view places a source; sources move like control points |
| Animation | timeline: drag on the ruler or a track scrubs, drag a key moves it in time; Play / Auto-key / Key / ✕ |
| Views | right drag: pan (flat views) / orbit (3D); middle drag: pan; W A S D held: pan the view under the mouse, Q / E down / up (Shift ×3); wheel: zoom; F: frame the selection (nothing selected: the view under the mouse) |
| Ruler | R, then drag anywhere |
| What is under the mouse | F1 (the **?** button) |
| Undo / redo / save | Ctrl+Z / Ctrl+Y / Ctrl+S (100 steps) |

## Data model

`level.json`, format 3. An example (shortened):

```json
{
  "format": 3, "name": "demo", "slot": "Canada", "source": "Canada",
  "track": {
    "section": 250, "clearance": 250,
    "nodes": [ { "id": "n0", "x": 5000, "z": 0, "y": 0, "width": 360, "vl": 320, "vr": 320 }, … ],
    "main": ["n0", "n1", …],
    "branches": [ { "id": "b0", "from": "n2", "to": "n5", "nodes": ["n8", "n9"] } ],
    "jumps": ["n3|n4"],
    "start": { "node": "n0", "reverse": false },
    "kerb": { "lid": 80, "foot": 140, "height": 30 },
    "kerbs": { "n0|n1:1": [[0.1, 0.9]] },
    "slippery": { "n0|n1": [[0.5, 0.6]] },
    "order": { },
    "ramp": { },
    "noVerge": { },
    "noTerrain": { },
    "signs": { "15": { "n3|n4": [[0.2, 0.4]] } },
    "camera": { "12": { "n3|n4": [[0.2, 0.4]] } },
    "marking": { "centre": "dashed", "edges": true },
    "crossings": { "n6|n7^n1|n2": "bridge" },
    "cuts": { "n0|n1": 19, … }
  },
  "paint": { "base": { "n0|n1:1|c-m|3": [[0.1, 0.25, "#ff00ff"]] } },
  "terrain": { "points": [ { "d": ["n0|n1", 3, "v", 1, 300, 0, 0] }, { "p": [1, 2, 3] } ], "tris": [ [0, 1, 2, "land"] ] },
  "assets": { "Canada/270": { "name": "Canada #270", "type": 200, "verts": [[-500, 0, -520], …], "faces": [[0, 1, 2, "#403c22", 17, 1], …] } },
  "objects": [ { "id": "o1", "asset": "Canada/270", "x": 5769, "y": 0, "z": -2881 } ],
  "sounds": [ ], "soundSources": [ ], "animations": [ ],
  "reference": { },
  "compileOptions": { }
}
```

Coordinates: `x` and `z` are the plan, `y` is up. A **segment** is the stretch between two neighbouring control points;
its key is the two node ids sorted and joined with `|` (`"n0|n1"`), and its **canonical direction** runs from the first
to the second id of the key. Ranges `[t0, t1]` are fractions (0–1) of a segment in its canonical direction, so they
stay in place when the sections are re-cut.

**Track**

- `nodes`: `x`, `y` (height), `z`; `width` road width (default 300); `vl` / `vr` drivable verge left / right of the
  driving direction (default 160); `tm` tangent mode (`linked` | `separated` | `corner`, absent = auto) with the
  handles `ti` (incoming) and `to` (outgoing) as offsets `[dx, dy, dz]` in the stored loop order.
- `main`: the node ids of the main loop in order. `branches`: `{id, from, to, nodes}` – a branch from the main-loop
  node `from` over its own `nodes` to the main-loop node `to`.
- `jumps`: segment keys without road. `start`: the start node and whether the direction is reversed.
- `section`: the maximum section length (it can only lower the built-in 250). `clearance`: the height needed at
  crossings (250).
- `kerb`: `{lid, foot, height, colours?: {in, top, out}}` – the kerb profile and the default colours of the kerb
  faces (paint overrides them).
- `kerbs` / `slippery` / `order` / `ramp` / `noVerge` / `noTerrain`: ranges per segment (`kerbs` also per side,
  `"<segment>:<side>"`; the side flips with the canonical direction).
- `signs` / `camera`: ranges per segment, grouped by the sign number / the camera value (flags as written to the game:
  1–10 move the camera by −50 per step, 11–20 by +50 per step above 10).
- `marking`: `{centre: "none" | "solid" | "dashed", edges: true | false}`.
- `crossings`: `{"<upper segment>^<lower segment>": "tunnel" | "bridge" | "none"}`, the choice per crossing (absent:
  automatic).
- `cuts`: number of sections per segment, **frozen** once the terrain exists (absent = computed from the length).

**Terrain**

- `terrain.points`: either attached `{d: [segment, i, ref, side, lat, along, dy], lock?, rim?}` or free
  `{p: [x, y, z]}`. `i` = frame index on the segment in the canonical direction (fractional = between frames); `ref`
  says what `lat` is measured from: `c` centre line (signed, left positive), `e` road edge, `v` outer edge of the
  drivable verge, `k1`–`k3` the kerb rows (outwards on `side`); `along` along the track, `dy` above the frame.
  `lock` = on the base's outer row, `rim` = outermost points.
- `terrain.tris`: `[a, b, c, material, paint?]`, material `land` | `drive` | `edge` | `dead`; paint as below.

**Paint**

- Paint values: `"#rrggbb"`, or `"png:<name>@<size>@<mapping>"` for a texture (mapping `auto` | `road` | `top` |
  `front` | `side`).
- `paint.base`: key `<segment>:<side>|<strip>|<q>` (strip = the two rows it lies between, e.g. `c-m`, `e-k1`, `k3-v`,
  or `cap0` / `cap1` / `deck`; q = the triangle in it), value: ranges `[t0, t1, paint]`.

**Objects and assets**

- `objects`: `{id, asset, x, y, z, rot?, scale?, collide?, hit?, kick?, light?}` – `rot` in degrees about x, y, z
  (x first), `scale` per axis (identity transforms are not stored); `collide: true` = Solid; `hit` = 44–48 (Hits the
  car); `kick` = 150 / 153 / 152 (Kicked away; 0 = off for an original that would be kicked by default); `light` =
  154 (Warning light; 0 = off for an original pylon).
- `assets[ref]`: the geometry of every used asset, stored once (dropped when no object uses it), so the level compiles
  without the original files. Originals (`"<level>/<index>"`, or `"<level>/<section>.<k>"` for objects taken from the
  landscape meshes): `{name, type, verts, faces}`, verts y up relative to the placement point, faces
  `[a, b, c, colour, flags, alpha, tile, uv]` with the tile `"<level>/<tex>/<n>"` and the corners in its texels (or
  null).
- Own assets (`"custom/<id>"`): `{name, custom: true, bodies: [...], groups?: [{id, name}], verts, faces}`. Faces carry
  the body and the body's face as elements 8 and 9; a textured face has `"png:<name>"` and texels of the whole image in
  6 and 7. A body's `texture = {name, px: [w, h], space: "body", o, ax, ay}` is its projector frame in the body's unit
  space (origin, full width and height as vectors); `name` and `group` (a group id) are optional.

**Sounds and animations**

- `sounds`: `[{id, name, gain (%), info: {seconds, rate, channels, bits}, stamp}]`; the converted file is
  `sound/<id>.wav` beside the level.
- `soundSources`: `[{id, sound, x, y, z}]` or, riding on an object, `[{id, sound, object, off: [dx, dy, dz]}]`.
- `animations`: `[{id, name, length (s), objects: [{object, keys: [{t, pos: [x, y, z], rot: [degrees x, y, z]}]}]}]`.

**Editor only**

- `reference`: `{top | front | left: {file, on, opacity (%), size (world units of the image's width), rot (degrees),
  u, v (shift right / up), stamp}}`; the compiler ignores it.
- `compileOptions` (not in the UI, for experiments): `group` (1–3 sections per placement, else automatic),
  `sceneryFar` / `sceneryCell` (scenery placements), `avoidLightning`, `jumpType7` (false: no type 7 pair at jumps),
  `kerbObjects` / `markingObjects` (kerbs / markings as separate objects), `light`, `steepDouble`, `steepSplit`
  (switch off the baked light and the fixes for steep faces). See [Compile rules](#compile-rules).

## Compile rules

What the compiler does to turn a level into game files, following [LEVELFORMAT.md](LEVELFORMAT.md) chapters 15, 18
and 20.

- **Sections:** every segment is cut into equal sections of at most 250 (rounded up, so none is longer), like the
  originals (239–296). Tested in the game: with 350-long sections a road triangle was drawn over the car, its shadow
  and tyre marks (the game sorts triangles by mean depth without a depth buffer); at 200 the problem was gone. Section
  boundaries lie on the control points. Levels with a stored terrain keep their frozen cuts.
- **Numbering** in driving order from the start: first section type 1, last type 0. At a branch the section ending at
  the fork is type 3, then the branch, then the main loop between fork and merge (or the other way round); the main
  section starting at the merge node is type 6. Every section (or group of sections, below) is one placement with one
  mesh and one gate, like the originals. At a fork or merge the main road runs through unchanged: the fork section's
  gate spans the whole undivided road, the merge section has its lane gate; the branch's sections take the wedge beyond
  the lane (see Junctions). Parallel paths: type 4 for the path with more placements, type 5 for the other (the game
  pairs the type 5 chain into the type 4 chain; a longer type 5 chain made the AI crash). `.PLC` flags3 = 10 (the fork
  sign) on the 6 sections up to a fork.
- **Jumps:** the road of the 2 sections before and after a gap gets the ramp code 10. On the main road outside
  fork / merge blocks the sections next to a gap are a type 7 pair: the game continues its track order from a type 7 to
  the nearest type 7, so the landing is found across a long gap. Inside a block they keep their path's type, as Carib
  does.
- **The game's track order:** at level start the game chains the placements geometrically (the nearest unvisited
  placement of the right type, height counting double, from the centre of the drivable faces). The compiler runs the
  same walk on the compiled placements and reports an error where it leaves the intended order – a stretch of track too
  close to another, stacked track, a long gap, a merge too close to a branch.
- **Junctions:** where two roads or their verges overlap (at one height, or at different heights without the roads
  themselves crossing, e.g. a branch climbing to its merge), the touching sections of both roads and one more on each
  side form a **zone** built as one surface: every band of every section (centre line, road, edge lines, kerb bands,
  verge) is outlined in plan, and all outlines are triangulated together. At the zone's ends the cross lines carry the
  same points as the strips outside, so zone and strips share their vertices (no cracks). A triangle is what its centre
  lies in: road first (the centre line, so a branch's centre line splits off the main road's; the edge line of the
  *joined* road, so the edge lines follow the joined outline, meet at the nose between the roads and do not cross the
  mouth of a branch; else road), then kerbs, then verge. Between the placements the surface is divided as in the
  originals: inside the main road's lane it belongs to the main section; the wedge beyond the lane up to the branch
  belongs to the nearest branch section; the main road's verge on the far side stays the main road's. A branch section
  whose road lies entirely in the lane has no faces and no placement. **Kerbs stop before a zone** (with their caps).
  **Heights:** every point of either road in a junction gets a blend of its own road's height and the other road's; the
  other road's weight is d_own / (d_own + d_other) – nothing on the own centre line, one half midway, fading out over
  800 beyond the other road's surface. All rows take these heights, so the attached terrain follows: a smooth height
  field. More than 20 % cross slope on the road gives a warning.
- **Bridges and tunnels:** see [Crossings](#crossings-tunnels-and-bridges). Tunnel walls, ceiling and fascia are
  double-sided with the wall code; a free-standing deck (road, underside, fascia) and the landscape hanging from a
  deck's end carry the ramp code 10 – a landscape-coded face whose top edge lies on the road stopped the car like a wall
  there, whatever its slope (tested in the game).
- **Placement point** in the middle of the section's road (a branch section at a junction that holds only the wedge:
  over those faces, behind its gate). **Gate** across the entry line from the outermost drivable point of the
  placement's own mesh on the right to the one on the left, sampled near road height and without steps or steep drops.
  **Walls** (edges between drivable and not drivable faces) must lie within 540 of the placement point – the game's
  wall check only works there (LEVELFORMAT.md ch. 20); the compiler warns per section beyond it, and for a cross
  section too wide for one mesh.
- **Meshes:** one per placement: the base faces of its sections plus the landscape triangles that belong to it, so
  road, kerbs, verge and the wall beside them are in one mesh and wall edges stay near the placement point. Face order
  inside a mesh: raised parts (kerbs) first, then road, ground last. Kerb and deck faces are double-sided (flag 0x15:
  thin faces fail the game's back-face test).
- **Landscape per placement:** the game draws a placement only while its **point** lies in a window around the camera
  – about 4600 ahead, 2560 to each side, 512 behind (LEVELFORMAT.md ch. 18); landscape of placements whose points were
  3300 to the side was missing in a test level although it reached to within 2500. So every landscape triangle goes to
  the placement with the **nearest point**. Beyond 800 of every point but within 3500 of some track placement (the
  ground between two stretches of track, seen from both), not drivable landscape is cut into **scenery placements**
  (type 50, no gate, cells of 1200, point in the middle of the cell's triangles; small, because a point more than 512
  behind the camera drops the whole cell). Beyond 3500 it is backdrop and belongs to the nearest track placement.
  Drivable landscape always stays with a track placement.
- **Placement budget:** the game has room for about **500 placements** (a level with 497 ran; one with 582 stopped
  with "Maximum of objects reached!" in the game's log `Default.fil`). The compiler counts track placements and objects
  first and grows the scenery cells (1200, 1600, 2000, 2500, 3200, 4000, none) until the level fits, with a warning;
  above 500 it reports an error.
- **Several sections per placement:** as many as the budget needs, at most 3 (`compileOptions.group` fixes it).
  Consecutive sections of one path share a placement (the gate of the first section, the point in the middle of their
  road, signs / camera / ramp from any member). A placement never spans a fork (the fork section is its last), a merge
  (the merge section is its first) or a jump gap. The wall rule bounds the length: 2 × 250 with the default cross
  section keeps walls within about 400 of the point, 3 × 250 about 490. A test level with 816 sections, 3 branches, 2
  jumps and a helix compiled to 477 placements and ran three laps with the AI.
- **Compiler fixes:** terrain edges longer than 2800 (drivable ground 600; within 2000 of the track 1000, steep faces
  there 400) are split at their middle in all triangles sharing them (no cracks, the surface stays). Near the track
  this matters because the game does not clip triangles at the camera: a large one reaching behind it is dropped as a
  whole (flicker when driving over a hill). Faces steeper than 60° are double-sided (0x15), as the game's back-face test
  drops them at grazing angles. More and smaller faces increase the `.SRF` collision records (one per face half and
  512 cell); the compiler warns above what the originals have (about 12400), though larger files have run.
- **Baked light:** the game does not light anything, so every flat-coloured face gets one colour = its colour (painted
  or the material's) × its light (ambient + sun on the face's normal, flat, so the facets show and slopes read as 3D;
  darker the deeper below the nearest road, up to 45 % at 900) relative to flat ground in the sun, × a fixed ±5 %
  variation per face so neighbouring faces of the same slope still differ. Textured faces are not lit (the game draws
  textures as they are). The editor's *Textured* view shows the same colours (before palette reduction).
- **Palette and texture:** all face colours and the texels of all used tiles are reduced by median cut (weighted by
  area) to at most 156 colours, palette indices 4–159; indices 0–3 and 160–255 (cars, effects) and the colour tables
  stay from the source level. Texture 0 is a grid of 16 × 16 cells of 16 × 16 texels, one plain colour per cell; a
  flat face points all three corners into the cell of its colour. Textures 1–15 hold up to 240 tiles of 64 × 64
  (4 × 4 per texture) – the originals' object tiles, your PNGs cut into tiles, animation frames first. With more than
  240 tiles the plainest ones fall back to their flat colour, with a warning. Every textured face is cut along the
  64-texel lattice of its image into pieces that each lie in one tile. Transparent texels become palette index 0 (see
  [Textures on own assets](#textures-on-own-assets) for which tiles the game draws see-through).
- **Objects:** every placed object is one placement of type 200 with its own mesh (rotation and scale are baked into
  the vertices; meshes are never shared), faces with the object code 300, the original winding and face flags; its flat
  colours take part in the palette and get the baked light. Type-200 objects have no collision and are not in `.SRF`.
  *Hits the car* writes types 44–48, *Kicked away* 150 / 152 / 153, *Warning light* 154 (LEVELFORMAT.md ch. 17 and
  19). *Solid* objects are no placements: their faces go into the mesh of the nearest track section with a surface
  code per body (own assets: wall 80 unless set, drivable 1, road 0, ramp 10, slippery 5, deadly 110; originals:
  wall), so the car collides with them and their walls count for the wall-distance warning.
- **Animations:** an animated object is placed at its pose at t = 0; its `.POS` path has length × 25 + 1 frames with
  the position (relative to the first frame) and the extra rotation relative to key 0, in the game's angles (1/10
  degree, continued over full turns; LEVELFORMAT.md ch. 8). The table entry holds the offset from the entry to the
  placement's block (tested in the game: writing 0 there made the level crash at start).
- **Sounds:** one marker placement per source (type 144 + slot, flags1 = 1, one tiny triangle at the source); a source
  on an animated object gets the object's path shifted by its offset. The game knows marker types only up to 157 =
  slot 13 (a slot 20 marker crashed the game's sound mixer). No `smpl` chunk is written: the whole clip loops. The
  copied original sound files keep their slots where no own sound takes them; a colliding original is left out.
- **Expected lap time:** the Info panel shows the lap time the originals' pace predicts, 0.72 s per 1000 units of the
  shortest lap (every branch block the shorter way; the longer way in brackets when it differs). Measured lap times of
  the originals against their shortest laps give 0.71–0.74 s per 1000 (Carib 0.53).
- **Lightning (Canada slot):** the game strikes lightning while the car is on placements 46–119 of the Canada slot
  (LEVELFORMAT.md ch. 19). `"compileOptions": {"avoidLightning": true}` puts 74 invisible filler objects at these
  numbers and the track from 120 on. It is **off by default**: with the fillers a test level did not start. So levels
  in the Canada slot get lightning.
- **Kerbs / markings as objects** (experiment, `compileOptions.kerbObjects` / `markingObjects`): the kerb bodies and /
  or the road markings are written as type 200 objects (4 sections per object); with markings as objects the road has
  no marking rows and the markings are separate quads 3 above the road. The game draws objects about 1470 units nearer
  than the ground, so they lie over the road – but also over the car up to that far in front of it. Collision comes
  from the ground beneath (the kerb footprint stays as flat drivable faces).
- **Surface codes:** road 0, slippery 5, deadly-wrong-order 20 (its verge 21), ramp 10, drop edge 11, drivable ground
  1, landscape / kerb / tunnel walls and ceiling 80 (a free-standing deck and the cliff under its ends 10), deadly
  ground 110, floating objects 300. Road-like faces (road, markings) take the code of their section's settings (wrong
  order 20, ramp 10, slippery 5), whatever their colour.
- **Base strips:** rows c, (m, l1, l2: markings), e, k1, k2, k3, v across the road; every strip of two triangles has
  the same diagonal (from the row nearer the road at the near frame to the row farther out at the far frame; inside
  the road from the edge to the centre line), because the game's painter sort by vertex-depth sum needs regular
  neighbours.

## Tests

For developers:

- `node editor/test/core.mjs` – the core self-test: track (numbering, types, checks), base (kerbs, flags, verge,
  bridge deck), generated terrain (closed, attached, editing operations, floating objects, long edges, split in four),
  paint (base paint survives re-cutting, palette ≤ 156, texture paint), markings, track changes keeping the terrain (no
  new holes, user holes, objects and colours kept, deterministic), objects (placement, rotation / scale, textures in the
  atlas, collision), asset bodies and booleans, projected textures, sections without terrain, crossing modes, spline
  tangents, animations (poses, `.POS` frames and angles), sounds (slots, markers, riding sources), and the game's rules
  (placement budget, grouping, track order). Not checked: whether a junction is drivable and smooth – look at it.
- `editor/test/tools/` – UI and inspection scripts using headless Chrome through the DevTools protocol (`cdp.mjs`, run
  with the editor running):
  `SCR=<screenshot dir> LEVEL=<level> node editor/test/tools/cdp.mjs view_junctions.mjs` takes screenshots of a level's
  branches; `view_bridge.mjs` of its bridges; `view_at.mjs` of any spot
  (`LEVEL=… AT=x,y,z VIEWS='[[yaw,pitch,dist],…]' MODE=terrain`, `WAIT=ms` for large levels). `holesvg.mjs` draws the
  open edges in plan; `adaptfuzz.mjs` applies random track changes and compares the open edges with a fresh "Generate
  terrain" after each step. `LEVEL` names a level in `data/levels`.
- `node editor/test/needbias.mjs`, `nearroad.mjs`: how far the triangles of a compiled level or an original reach along
  the road (painter sort).
- In the browser console, `window.editor` exposes the level, selection, views and helpers (`setTab`, `startAssetEdit`,
  `describeAt`, `screenOf`, `setTime`, …) for such scripts. Headless screenshots of the 2 × 2 views show only the view
  rendered last: maximise a view first.
- The server loads the core at start: **restart it after every change in `editor/core/` or `editor/server.js`**, or
  the browser (new code) and the server's compile (old code) drift apart.

## Known limits and open questions

Tested in the game and running: levels with branches (three branches, long parallel paths), jumps, a helix, tunnels
and free-standing bridges, own sound slots, transparency on the slot's tile numbers, about 500 placements, AI drivers and
lap counting. Open:

- **Road markings** crashed the game as part of the road faces in a test, and as objects they show through the car
  and the kerbs. A way via the road texture is still to be found.
- **Kerbs through junctions:** kerbs stop before a junction zone; the planned design (kerbs along the joined outline,
  meeting at the nose with a cap) is not built yet.
- **"Wrong way"** flashes at a merge when arriving from the shorter (type 5) path.
- **Track stacked over itself** (a helix): the game's track order weighs height double, but gates are lines in the plan
  and its drawing grid is flat; stacked stretches closer than about 500 (height × 2) are not supported. The compiler
  reports the deviation, and the landscape around it glitches.
- **Not yet seen in the game:** blended (part-transparent) tiles, the expected lap time against a real lap, the
  animation frame rate (25 assumed), the camera offset direction, slippery and "deadly if wrong order" road, the
  automatic signs, the default kerb profile in both driving directions, the finer landscape near the track (against
  flicker), sections of 250.
- **Lightning** cannot be avoided in the Canada slot yet (the filler option made the level not start).
- **Corner tangents** are not mitred: the inner side overlaps.
- **Not built:** one-shot sounds, ease in / out and delayed starts for animations, simplifying the landscape (merging
  flat triangles; long thin triangles are drawn badly by the game), surface types per face beyond the four materials,
  smooth colour gradients.
