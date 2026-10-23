# Ignition (1997) – Level format

Documentation of the level file format of *Ignition* (Unique Development Studios, 1997, Windows/3dfx version), worked out from the game's level files and from tests in the game.
All details were checked against the seven original levels (Austria, Brazil, Canada, Carib, Iceland, Japan, USA). The reference implementation is [`../viewer/convert.js`](../viewer/convert.js) (reads a level: meshes, placements, textures, effects, gates, collision) with [`../viewer/index.html`](../viewer/index.html) (rendering and runtime behaviour), and [`../editor/core/`](../editor/core/) (writes levels: [`compile.js`](../editor/core/compile.js), [`formats.js`](../editor/core/formats.js)).

Every statement is marked:

- **confirmed**: checked byte for byte or established as the game's behaviour, applies to all levels (exceptions named)
- **observed**: observed in the game, matches the data
- **assumed**: plausible, not proven
- **unknown**: data present, meaning open

---

## Contents

1. [Basics](#1-basics)
2. [Directory structure](#2-directory-structure)
3. [Palette `.COL`](#3-palette-col)
4. [Textures `.TEX`](#4-textures-tex)
5. [3dfx effect tiles `.TFX`](#5-3dfx-effect-tiles-tfx)
6. [Meshes `.MSH`](#6-meshes-msh)
7. [Placements `.PLC`](#7-placements-plc)
8. [Animation paths `.POS`](#8-animation-paths-pos)
9. [Track gates `.TRI`](#9-track-gates-tri)
10. [Collision index `.SRF`](#10-collision-index-srf)
11. [Software-Renderer tables `.TAB`, `.SHD`, `.PAN`](#11-software-renderer-tables-tab-shd-pan)
12. [Preview image `.PIC`](#12-preview-image-pic)
13. [Sounds](#13-sounds)
14. [`GENERAL` directory](#14-general-directory)
15. [Placement types](#15-placement-types)
16. [Face flags](#16-face-flags)
17. [Surface codes](#17-surface-codes)
18. [Rendering rules](#18-rendering-rules)
19. [Runtime effects](#19-runtime-effects)
20. [Consistency rules for new levels](#20-consistency-rules-for-new-levels)
21. [Open questions](#21-open-questions)

---

## 1. Basics

**Byte order:** Little endian. `int32` = signed 32 bit, `uint16` = unsigned 16 bit, and so on. Structures are tightly packed, without alignment (in `.TRI`, `double` values sit at odd offsets).

**Units:** Integer world units. A roadway is about 300–400 units wide, a level about ±8000 units in size.

**Coordinate systems** (confirmed):

| Space | x | y | z |
|---|---|---|---|
| Mesh-local (`.MSH`) | right | **down** | forward |
| World (`.PLC`, `.POS`) | right | **up** | forward |

```
World point = (pos.x + v.x,  pos.y − v.y,  pos.z + v.z)
```

`pos` is the placement from `.PLC` or `.POS`, `v` the local vertex. Meshes are only translated, not rotated and not scaled; they are already modelled in world orientation. Only animated objects rotate (see [8](#8-animation-paths-pos)).

**Cache coordinates** in `.TRI` and `.SRF` (confirmed): x and z are shifted by **+25600** so that all values are positive. 25600 = 50 × 512 (see grid in [10](#10-collision-index-srf)).

**Conversion to right-handed Y-up systems** (glTF, three.js, OBJ): `(x, y, −z)`. This is a pure mirroring of z; it reverses the triangle winding order (see [18](#18-rendering-rules)).

**Texture coordinates:** Texel coordinates in the 256×256 image as 8.8 fixed point (value / 256 = texel). Not normalised.

---

## 2. Directory structure

```
<Game>/
├── sys.col                     system palette (also for GENERAL/*.tfx)
├── GENERAL/                    effect textures and sounds shared across levels
│   ├── *.TEX / *.tfx
│   └── SOUND/{Boost,COLL,Div,ROLL,SKID}/NN_name.{wav,pat,xi}
├── CARS/                       vehicles (Cars.msh/.plc/.tex, same formats)
├── Ghosts/*.GST                recorded best laps (not documented)
└── LEVELS/<Level>/
    ├── <L>.COL   palette
    ├── <L>.TEX   textures (8 bit, palettised)
    ├── <L>.TFX   3dfx versions of individual effect tiles        (optional)
    ├── <L>.MSH   all meshes
    ├── <L>.PLC   placements (one per object instance)
    ├── <L>.POS   animation paths per placement
    ├── <L>.TRI   track gates (cache)
    ├── <L>.SRF   collision index (cache)
    ├── <L>.TAB / .SHD / .PAN   tables for the Software-Renderer
    ├── <L>.PIC   320×200 image
    └── Sound/NN_name.{wav,pat,xi}   ambient sounds
```

File names are looked up case-insensitively (mixed in the original: `CANADA.MSH`, `Canada.pic`).

**Level names in the game** (assumed, from `Ghosts/`): Austria = *Yodel Peak*, Brazil = *Lost Ruins*, Canada = *Moose Jaw*, Carib = *Snake Island*, Iceland = *Cape Thor*, Japan = *Tokyo Bullet*, USA = *Goldrush*.

`LEVELS/Canada_Japan` is a byte-identical copy of `Japan` under `CANADA.*` names, without `.TFX`. Not a level of its own.

---

## 3. Palette `.COL`

Confirmed. 776 bytes.

| Offset | Type | Content |
|---|---|---|
| 0 | uint32 | 776 (file size) |
| 4 | uint32 | 0x0000B123 (identifier, always the same) |
| 8 | 256 × (uint8 r, g, b) | colours, full 8 bits per channel |

- **Index 0** is transparent on faces the game draws colour-keyed: chosen per tile number from a fixed table per level slot, or by flag 0x13 / 0x17 (chapter 16).
- **Indices 160–228 and 230–255** are identical in all seven level palettes and in `sys.col` (confirmed; only index 229 differs). So only **indices 1–159** are free per level. The shared part contains the grey ramp 229–251 (0, 16, 25, …, 255) used by the `GENERAL` effects (see [14](#14-general-directory)); the car textures (`CARS/Cars.tex`) also use only indices from 160 upwards (confirmed).
- **Own palette** (observed): works. Tested with own colours in 4–159, indices 0–3 and 160–255 taken from Canada, and `.SHD`/`.TAB`/`.PAN` transferred to the new palette (chapter 11), with 16 textures (chapter 4): cars, tyres and effects correct, colours more saturated than with a foreign palette. Whether 1–3 must be kept free and the tables must be transferred has not been checked individually. The first attempts with an own palette failed only because there were too few textures.

---

## 4. Textures `.TEX`

Confirmed. A sequence of textures, each **256 × 256 pixels at 1 byte** (palette index), row by row, starting top left. Typically 16 textures (1 048 576 bytes).

- **At least 16 textures** (observed): With only one texture in `.TEX`, the car tyres turn light grey instead of black; padded to 16 textures, they are correct again. The content of the extra textures does not matter: filled with colour noise, everything runs normally. The tyres are the faces of `CARS/Cars.msh` with code 17 (texel mostly index 229); assumed: the game loads the car textures behind 16 level textures, and the tyres point to this position in a fixed way. All original levels have 16 textures, Iceland 17.
- **Count** = file size / 65536, rounded down. Surplus bytes at the end are padding zeros (Austria +192). Incomplete last textures occur (Japan: 15¾ textures).
- **Tile grid:** Each texture consists of 4 × 4 **tiles at 64 × 64**. Faces practically always use exactly one tile. Tile number `n` = column + 4 × row.
- **Tile of a face:** `n = floor(min(u)/64) + 4 · floor(min(v)/64)`.
- A face refers to its texture by **byte offset** (see [6](#6-meshes-msh)).
- **Effect tiles** (water, clouds, fog, shadows) in `.TEX` partly contain no finished colours but raw values for the Software-Renderer, see [5](#5-3dfx-effect-tiles-tfx) and [18](#18-rendering-rules).

---

## 5. 3dfx effect tiles `.TFX`

Confirmed (format), assumed (mapping). A sequence of 64×64 tiles, stored **in the layout of a texture 256 pixels wide**: 4 tiles side by side, then the next row of tiles. Tile `j` is at row `j div 4`, column `j mod 4`. Count = file size / 4096.

The tiles contain **finished palette indices** for the 3dfx version. The matching `.TEX` tiles are partly raw values (brightness levels) that the Software-Renderer colours via tables.

**The mapping TFX tile → TEX tile is not stored in the data.** The converter reconstructs it as follows:

1. **Structure comparison:** For each TFX tile, the converter searches for the TEX tile for which a consistent mapping "TEX index → TFX index" holds for ≥ 95 % of the pixels. Mappings that merge many indices into one (empty or mask tiles) are discarded.
2. **Mutual information:** Remaining TFX tiles are paired with effect and transparency tiles via normalised mutual information ≥ 0.45, best pairs first, one to one each. Example: Japan fence, orange gradient in TEX, grey mesh grid in TFX.
3. **Level-wide recolouring:** The mappings from step 1 (only approximately one to one) are combined into one table and applied to all remaining effect tiles, including all frames of animation tables (see [15](#15-placement-types)).
4. **Holes:** Colours that TFX versions of transparency tiles set to index 0 are also set to 0 in the other transparency tiles of the same mesh (Carib propeller cage).

**Exceptions:**
- **Fog tiles** (only indices 144–153 and 0) are not recoloured, see [18](#18-rendering-rules).
- `.TFX` is missing in `Canada_Japan`.

**The game uses a fixed mapping per level slot:** after loading `LEVELS\<L>.TFX` the game copies TFX tile k over texture-memory tile number N for a fixed list per level slot - Canada: TFX 0–3 → tiles 85–88 (the fog); USA: 14 tiles (172–175, 180–183, 74, 82, 91, 97, 136, 171); Carib: 20 (0, 40, 22–35, 47, 37–39); Brazil: 22 (166, 85–103, 155, 156); Iceland: 7 (29–35); Austria: 8 (75, 152, 127, 128, 71–74); Japan: 3 (32–34). A level in a slot must keep those tile numbers free (the level editor does), or write its own `.TFX` for them.

**For new levels:** Store effect tiles directly with finished colours in `.TEX`; the slot's `.TFX` is copied along and lands on the numbers above.

---

## 6. Meshes `.MSH`

Confirmed. The file is a gapless sequence of meshes up to the end of the file. A mesh is addressed by its **offset in dwords** (byte offset / 4).

```
Mesh:
  int32  nVerts
  int32  nFaces
  nVerts × Vertex
  nFaces × Face

Vertex (12 bytes):
  int32  x, y, z              local, y down

Face (44 bytes):
  +0   uint16  flags          see chapter 16
  +2   uint16  surface        surface code, chapter 17
  +4   int32   i0, i1, i2     vertex indices (degenerate faces with duplicate indices occur)
  +16  int32   u0, v0         8.8 fixed-point texels
  +24  int32   u1, v1
  +32  int32   u2, v2
  +40  int32   texOffset      byte offset of the texture in .TEX = texture number · 65536
```

**Addressing a face in dwords** (used by `.SRF`, confirmed):

```
faceDword = 2 + 3 · nVerts + 11 · faceIndex      (relative to the start of the mesh)
```

In the original levels, each mesh is placed exactly once (number of meshes = number of placements; exception Iceland, where the `.TRI` count differs).

---

## 7. Placements `.PLC`

Confirmed.

```
int32  count
count × Placement (20 bytes):
  +0   int32   meshOffset     in dwords in .MSH
  +4   uint8   type           placement type, chapter 15
  +5   uint8   flags1         0 | 1 | 16 | 17 | 32 | 48
  +6   uint8   flags2         camera offset (0..14)
  +7   uint8   flags3         warning sign (0..16)
  +8   int32   x, y, z        world position, y up
```

- **Position in the file:** The number of the placement is the key for `.POS`, `.TRI` and `.SRF`. For track sections, it also defines the **driving order** (chapter 15).
- **Placement point `x, y, z`:** Reference point of the mesh vertices. For track sections, seen from above, it lies over the roadway of the section (94 %), in height mostly between the vertices; the game checks walls only near this point (chapter 20, rule 9).
- **`flags1`:** Bit 0 (= 1) marks markers and objects with special handling (sound sources, emitters, moving objects). The upper half (16/32/48) is a **visibility group** (chapter 18); what the originals use the groups for is unknown. Carib uses 0 throughout and renders correctly; the level editor writes 0.
- **`flags2`:** **camera offset** while a car is on this section: 1–10 shift by −50 · value, 11–20 by +50 · (value − 10); the camera moves there smoothly. Carib sets 1, 2, 3, 4 before its U-turn. Not an AI hint.
- **`flags3`:** **warning sign** shown while a car is on this section (observed in the game): the number of the sign in the 4 × 4 sheet `H_signs.pic`, 0 = none. Seen in the game: 1 slight left, 2 slight right, 3 left, 4 right, 5 sharp left, 6 sharp right, 7 U-turn, 8 U-turn to the other side, 9 jump, 10 fork, 11/12 chicane, 13 warning, 14 crest, 15 drop (a car tipping over an edge). From the sheet (not tested): 16 wrong way. The originals set it on about 5–6 sections before the spot (measured in the seven levels): odd values for bends to the left, even ones to the right; 1/2 for a total turn of about 50–60°, 3/4 about 125°, 5/6 140–190°; forks see chapter 15.
- **Order of the placements:** It determines the chaser light of the warning lights (chapter 19).

---

## 8. Animation paths `.POS`

Confirmed.

```
int32  table[count]            count = number of placements; −1 = not animated, else the offset (in int32 units)
                               from this table entry to the placement's block: block index − placement index
then for each animated placement, in table order:
  int32  n                      number of frames
  n × Frame (24 bytes):
    int32  r0                   rotation about the longitudinal axis (1/10 degree)
    int32  x, y, z              position (world, y up)
    int32  r1                   rotation about the lateral axis (1/10 degree)
    int32  r2                   rotation about the vertical axis (1/10 degree)
  int32  0                      terminator
```

**The table values are needed:** the game reads the whole file into memory and reaches a placement's block through `table[i] + i`; all originals hold exactly block index − placement index there (Austria's first block at int32 321 for placement 256: value 65). A 0 in the table made the game read the table itself as the block and crash in the animation step (tested in the game with the test level MyThird, after six "FEL VID LI_MOVEOBJECT ANIM OBJ" lines in the game's log `Default.fil`). Seen from the game, a block is `n`, a frame counter (the file's 0 after `n`; it runs 0..n−1 at play time) and n records `x, y, z, rA, rB, rC` - the same bytes, shifted by one int32: the game's third angle of frame k is the file's `r0` of frame k + 1 (and the terminator for the last frame), so `r0` reaches the object one frame late.

**Playback:** at level start the positions are turned into differences in place, `frame[k].xyz − frame[k+1].xyz` and, for the last frame, `frame[n−1].xyz − frame[0].xyz`; every frame the object's position moves by the difference of the current frame, its three angles are set from the frame (16-bit words; a value of 3600 or more has 3600 taken off once, negative values stay), and the counter goes on, back to 0 after frame n−1 - so the loop always closes on the first frame's position, whatever the last frame holds. The game refuses a position outside the object grid (200 × 200 cells of 256 units) and logs "FEL VID LI_MOVEOBJECT ANIM OBJ" (Swedish: error at) in `Default.fil`; the object then stays where it was and the game goes on.

**Playback rules** (confirmed or observed):

- **Translation:** `World position(t) = Placement.pos + (frame[t].xyz − frame[0].xyz)`. So the path positions are relative to the first frame (the game moves the object by the frame differences, see above).
- **Rotation** about the mesh's **own origin** (observed on the USA wind turbine: the placement sits exactly on top of the tower, the path position 300 units beside it). Order `YXZ` with Y = r2, X = r1, Z = r0.
- Angles continue over several revolutions; when interpolating, take the shortest path.
- **Loop:** After the last frame, the path restarts hard at frame 0 (do not interpolate back; the game's last difference leads from the last frame straight back to the first).
- **Frame rate:** not contained in the data. The Viewer uses 25 frames/s (estimated).
- **Riding markers:** Sound markers with their own path follow it as well (e.g. boat sound on the hovercraft).

Examples: trains, lorries, hovercrafts, aeroplane, tornado (rotates about the vertical axis), rolling snowballs and stone balls, wind turbine.

**What the originals animate** (counted in the seven levels): 2–21 placements per level. Vehicles are types 44 (Canada train: 4 placements, 551 frames, path 10 300 long; Carib hovercraft 400 frames; Iceland 143–151 frames turning on the spot), 46/47 (USA, Brazil lorries), 48 and 101 (Austria snowballs, 201–401 frames, avalanche); but plain **type 200 objects are animated as well** (Japan 12, Austria 2, USA 1 - with `flags1` 0, 16, 32 or 48, so bit 0 is not needed for a path) and markers ride along (sound markers 144–152, smoke emitters 95). Frame counts 45–1201. So for a new level: any object placement gets a path simply through its `.POS` entry; the types 44–48/101 are what the game treats as vehicles (collision with the car is assumed for them, untested), type 200 is safe for decoration that moves. The frame rate is not in the data (viewer: 25/s, to be measured in the game once).

---

## 9. Track gates `.TRI`

Format partly confirmed. A **precomputed cache**, in the original months older than `.MSH`/`.PLC`.

```
int32  unknown                   Austria 305, Brazil 231, Canada 247, Iceland/Japan 341 … (unknown)
N × Record (500 bytes)           N = number of placements at the time of creation
  +0    uint8   surface          surface code of the track section (chapter 17), observed
  +1    uint16  vertexA          vertex index in the mesh of placement k
  +3    int32   xA + 25600
  +7    int32   yA               ≈ −3 · world y (not exact)
  +11   int32   zA + 25600
  +15   8 bytes 0
  +23   uint16  vertexB
  +25   int32   xB + 25600
  +29   int32   yB
  +33   int32   zB + 25600
  +37   8 bytes 0
  +45   6 × double   unknown (angles in the range ±π; π/2 works, see below)
  +93   double  D6               gate direction atan2(zB − zA, xB − xA), game coordinates
  +101  double  D7               D6 ± π (opposite direction)
  +109  391 bytes    unused (zeros or memory leftovers; zeros work)
```

**Meaning** (confirmed): Record `k` belongs to placement `k`. A and B are the **left and right roadway edge** across the track, a "gate". The gate lies at the **entry edge** of the track section, i.e. at the edge it shares with the previous section (Canada: 186 of 198 gates).

**Which records apply** (confirmed, checked on all seven levels):
- Only records of **landscape placements (type 0–8, 50)** are needed. In the originals, every placement of type 0–8 has a gate (exception: Japan type 8); type 50 has none.
- Records of all other placements (markers, objects, pylons, animation tables) contain zeros or **uninitialised memory**. Their vertex indices match only by chance, if at all.
- **Placements appended later:** The cache was created when the level had fewer placements. Records beyond that are memory leftovers (recognisable by non-zero bytes at +15..+22 or +37..+44) or are missing entirely (Iceland: 233 records, 247 placements).
- **Re-sorted placements:** Occasionally a clean record points to a placement whose mesh now has fewer vertices (vertex index out of range). Skip such records.
- The header value is **not** a count of valid records (only equal by chance for Brazil and USA).

**Driving order** (observed in Canada and Japan, start/finish confirmed in all levels): The gates are **numbered in ascending order in the driving direction**, number = placement number. The sequence begins at the track section of type 1 and ends at type 0 (start/finish, chapter 15). On parallel tracks, first one branch is numbered through, then the other; after that it continues with the next number (type 3/6). The order is not stored in `.TRI` itself; there are no reference fields.

**Rule for evaluation** (confirmed): The stored coordinates are **outdated**; the vertex indices are correct. So compute gates as `World point(mesh of placement k, vertexA/B)`; this also gives the exact height. Some levels were shifted as a whole after the cache was created: Iceland by (−71, +463) in x/z, Austria by +14 in z (previously noted as "+25614").

**Use in the game** (observed): A new level with gates built by these rules runs, **including with computer opponents**; the AI finds the track (test level Ring A, chapter 20). Whether the game reads the doubles or recomputes them is open. Assumed: lap counting, "Wrong Way", race position, AI line and the rule "deadly if reached outside the gate order" (chapter 17).

---

## 10. Collision index `.SRF`

Confirmed. A precomputed index of the **landscape collision**: all faces of the landscape placements (types 0–8 and 50), split into two triangle halves and sorted into a grid.

```
+0    int32  200, 200            unknown (probably reserved grid size)
+8    int32  512, 512            cell size in world units
+16   int32  gw = 101, gh = 101  grid size
+24   int32  nRec                number of records
+28   int32  nA                  length of list A (entries)
+32   int32  nB                  length of list B
+36   gw × gh × Cell (12 bytes), row by row, cell (col,row) covers
      x ∈ [col·512, (col+1)·512), z ∈ [row·512, …) in cache coordinates
        uint32 offB     byte offset into list B
        uint32 offA     byte offset into list A
        uint16 cntA
        uint16 cntB     empty cells: cntA = cntB = 0, offsets contain garbage
nRec × Record (24 bytes)
nA × uint32   list A: byte offsets into the records
nB × uint32   list B: byte offsets into the records
```

**Record** = one half of a triangle, prepared for scanline queries:

```
+0   int32   x + 25600         anchor point = corner of the triangle
+4   int32   z + 25600
+8   int32   s1                dx/dz of the left edge (16.16 fixed point)
+12  int32   s2                dx/dz of the right edge (16.16)
+16  int16   h                 z span up to the middle corner
+18  uint16  faceDword         face address in the mesh (chapter 6)
+20  int32   placement · 42    number of the placement × 42
```

- **Halves:** Records in **list B** are anchored at the corner with the **smallest z** (`h > 0`). Records in **list A** are anchored at the corner with the **largest z** (`h < 0`). Every face appears exactly once in each list.
- **`s1` is always the left edge** (smaller x in scan direction).
- **Cells:** A cell lists all records whose half it covers; a record can appear in several cells.
- **Included:** all faces of the landscape placements, including vertical walls. These only produce strips of zero width (`s1 = s2`).
- **Cell assignment:** not fully understood. A generated `.SRF` (`../editor/core/formats.js`) with byte-identical records assigns cells by the bounding rectangle of each half. For the game this is not critical: original Canada with a generated `.SRF` drives unchanged, including at the walls (test T1). The original partly assigns fewer cells, partly also cells outside the half (up to about 380 units away). USA: 57 entries only in the original, 260 only in the generated file.
- **Not included:** individual objects (type 200), pylons (154), moving objects, markers. Their collision works differently (assumed: bounding volumes).
- **Size:** the originals have at most 12 427 records (Canada); a level with about 27 000 records runs (test level SplitJoins from the level editor). The game loads the whole file into memory allocated by its size and turns the offsets into pointers in place, so there is no fixed limit on records or cells.
- **Outdated data:** Like `.TRI`, a cache, partly older than the meshes (Austria: placements re-sorted since then, only 15 % of the references are correct). Check validity: the anchor point must be a corner of the addressed face. Otherwise assign via geometry: anchor point plus edge end point `(x + s·h/65536, z + h)` must be corners of one face.

---

## 11. Software-Renderer tables `.TAB`, `.SHD`, `.PAN`

Each 65536 bytes = 256 × 256 palette indices (`table[row·256 + col]`). The 3dfx version loads them too (see below); they are tailored to the level's palette.

| File | Finding |
|---|---|
| `.TAB` | Row = source colour; 77 % of the entries return the row colour unchanged, only columns 3–63 change it (assumed: transparency/fog over intensity levels). Identical in almost all levels. |
| `.SHD` | Column = colour, row = light level: 0–31 brighten (factor 1.0 to 2.2), 32–63 ramp from black to 2.2, further effects above that; row 0 almost the identity. |
| `.PAN` | Row = colour: 160–255 unchanged, most level colours to 0, only the first rows varied. Meaning unknown; not a panorama image. |

Meaning in detail unknown. For new levels with the palette of an original level: take over its tables. With an own palette: transfer them, i.e. map each new colour to the nearest colour of the original palette, look it up there in the original table and map the result back to the nearest new colour (colour axis: `.SHD` columns, `.TAB`/`.PAN` rows; level editor [`../editor/textures.js`](../editor/textures.js)). Tested this way, works (chapter 3).

**`LEVELS/*conv.tab`** (confirmed): each 262 144 bytes = 64³, one colour cube per level palette. Entry `(r >> 2) << 12 | (g >> 2) << 6 | (b >> 2)` is the palette index of the (nearly) nearest colour. Mapping: `1b4d` Canada, `479d` Brazil, `4e1f` Iceland, `52a7` Austria, `acef` Japan, `b6c9` Carib, `fbdb` USA. Only the DOS version of the game uses the cubes (reads and writes them); the 3dfx version does not use them. How the name is formed is open (not a simple checksum of the `.COL`).

**Loading in the 3dfx version** (confirmed): the 3dfx version loads `.COL`, `.SRF`, `.POS`, `.TAB`, `.SHD`, `.PAN`, `.PIC` and `.TFX` of a level; so `.TAB`, `.SHD` and `.PAN` are not only for the Software-Renderer. Structure: `.SHD` column = colour, row = light level (0–31 brighten up to factor 2.2, 32–63 ramp from black to 2.2, further effects above that); `.TAB` row = colour, columns 0–63 parameters; `.PAN` row = colour (160–255 unchanged, most level colours to 0).

---

## 12. Preview image `.PIC`

Assumed. 64 846 bytes: header (+0 `uint32` file size, then among others `uint16` 320 and 200), followed by 320 × 200 pixels at 8 bits and a palette. Probably a loading or selection screen. USA additionally has `Usa0..2.pic`.

---

## 13. Sounds

Confirmed.

- **Ambient sounds:** `LEVELS/<Level>/Sound/NN_name.{wav,pat,xi}`. `NN` is the two-digit number the sound markers refer to (chapter 15). Formats: WAV, Gravis patch, FastTracker instrument.
- **Material sounds:** `GENERAL/SOUND/ROLL/NN_*` (rolling) and `SKID/NN_*` (skidding), with `NN` = material: 00 asphalt, 01 gravel/grass, 02 mud, 03 sand, 04 snow (chapter 17).
- **General:** `GENERAL/SOUND/{Boost,COLL,Div}`: horns, collisions, start signal and so on.

**Loading and limits:**
- The game loads a sound directory as a whole (`*.*` scan): bank 0 = `GENERAL\SOUND`, bank 1 = `LEVELS\<Level>\SOUND`, bank 2 = the cars' sounds. A missing level sound directory stops the level ("Error while loading sound" in the log). A file is taken when its name starts with a digit; the leading number (any length) is the **slot** 0–127 in the bank (8 banks of 128 slots). A level's sound markers refer to the slot through the placement type 144 + NN (chapter 15), and the game knows those marker types only up to **157 = slot 13** (a marker of type 164 for slot 20 was created as a plain object and the game crashed on its missing sample, tested in the game) - so the slots are **0–13**, as Canada uses them. In the Canada slot 00–02 are the weather sounds (rain, thunder, lightning; chapter 19). Assumed: 16 mixing channels.
- Extensions read: `.WAV` (RIFF PCM), `.PAT` (Gravis patch), `.RW8` (raw 8-bit samples), `.XI` (FastTracker instrument). For `.WAV` the game checks the `fmt ` chunk (PCM, **mono**), takes 8 or 16 bits per sample (8 is what all 44 originals use; 16 goes through a conversion, untested) and any sample rate (originals: 11025 Hz), and reads a `smpl` chunk for the **loop points**; without one the whole clip loops. The data is allocated in the size of the `data` chunk - no fixed limit; the originals go up to 77 KB (7 s at 11025 Hz / 8 bit, Carib), 200–430 KB per level in all.
- **Playback of a marker sound:** every marker (type 144 + NN with `flags1` = 1, type word 400 + NN, chapter 15) gets its own endless looping voice at level load - bank 1, slot NN, rate 11000 Hz, volume 0 - and keeps it for the whole race; its volume is set every frame. The mixer has 256 voices, so a few dozen markers are fine (Brazil runs 35). Each frame the voice's volume is set to `0.75 × (1500 − d) / 1500` (as 16.16 fixed point), clamped at 0, with `d` the **horizontal** distance (x and z only, height ignored) between the marker's placement point and the car the camera follows (in split screen the louder of the two cars' values; the three fixed replay cameras of a level use the camera's position). This law cannot be changed from the level: a source is silent beyond 1500, at half amplitude (−6 dB) 750 from the marker and at the sample's level (×0.75) only right at it; as the ramp is linear in amplitude the sound comes up from inaudible to −10 dB within the outer 500 and then changes little, so at racing speed it is heard as a short, abrupt sound a few seconds long. There is **no gain, pitch, radius or one-shot flag in the level data**. What the originals do instead is **several markers of one slot**: stacked at one place for loudness (every voice adds its amplitude; Canada's six markers of slot 3 lie 260–430 apart, Carib's four boats 400–550) or **spaced along a stretch** for a long, even carpet (Brazil's six markers of slot 7 are 870–1340 apart, slot 4 1360–1640; with markers every 500–800 the sum of the ramps is nearly constant between them, and only the 1500 fade at both ends remains). The sample data itself should use the full 8-bit range (the originals' peaks are 66–128 of 127, RMS 10–26).
- Recommended for new levels: WAV PCM 8 bit mono 11025 Hz, loop points in a `smpl` chunk for ambient loops, slots 3–13 (0–2 for the slot's weather), a marker placement of type 144 + NN with `flags1` = 1 and one invisible triangle at the position (a `.POS` path makes it ride along, chapter 8).

---

## 14. `GENERAL` directory

Confirmed (format), observed (use). Effect textures shared across levels in the **TFX layout** (64×64 tiles, 4 per row). The `.tfx` values are indices into the **grey ramp 229–251 of `sys.col`**. The `.TEX` counterparts are software versions with dithered edges.

| File | Content | Use | Blending |
|---|---|---|---|
| `Smoke.tfx` | white cloud, 8 frames (growing, decaying), included twice | waterfall mist (102), geysers (49) | **additive** (dark edge ⇒ soft transition) |
| `Darksmok.tfx` | dark cloud, 8 frames | lava smoke (95, 103), smoke after lightning | **multiplicative** (`target · texture`) |
| `Light.tfx` | 5 light flashes, then 11 frames of a fountain | warning lights of the pylons (frames 0–4) | additive, 50 % |
| `Exsmoke.tfx` | explosion cloud, 15 frames | explosions (assumed) | – |
| `Boom.tfx` | explosion | explosions (assumed) | – |
| `Divspr.tfx` | stars, highlights, spheres | unknown | – |

**Caution:** Look up files by exact name (`Exsmoke.tfx` also ends in `smoke.tfx`).

---

## 15. Placement types

`type` = first flag byte of the placement. Confirmed unless stated otherwise.

| type | flags1 | Meaning | drawn | in `.SRF` |
|---|---|---|---|---|
| 0 | 0/16/32/48 | **track section with start/finish**, exactly once per level (observed) | yes | yes |
| 1 | 0/16/32/48 | **first track section after start/finish**, exactly once per level (observed) | yes | yes |
| 2, 8 | 0/16/32/48 | track sections; difference unknown | yes | yes |
| 4, 5 | 0/16/32/48 | **track sections of the two parallel paths** between a fork (3) and its merge (6): one path entirely type 4, the other type 5 (observed in all seven levels) | yes | yes |
| 3 | 0/16/32/48 | **fork** of a parallel track (observed) | yes | yes |
| 6 | 0/16/32/48 | **merge** of a parallel track (observed) | yes | yes |
| 7 | 0/16/32/48 | occurs as a pair k, k+1 with a gap of 900–1100 units; assumed: jump over the track itself, bridge or crossing | yes | yes |
| 50 | 0 | landscape without gate, not drivable (Canada train ramp, Carib: almost only code 110/131/80/79); `.TRI` record with doubles = 0 | yes | yes |
| 44–48 | 1 or 17 | **objects that hit the car**, moving (path in `.POS`) or standing: the game tests the car against the faces of every object whose type word (type + 256, see below) is 300–349 and reacts to that word, not to the face codes: 44 train / hovercraft / truck (car state 1, effect 3), 45 thrown up as by a geyser (no original object), 46 USA lorry (the car blows up), 47 rolling stones (Brazil, USA: flattened), 48 Austria snowballs (car state 3, effect 10); the originals give the faces the matching code (chapter 17) | yes | no |
| 97, 101 | 1 | moving objects without a reaction of their own (Austria avalanche 101 = effect type 357, faces code 90) | yes | no |
| 49 | 1 | **geyser emitter**: flat quad, invisible | no | no |
| 95 | 1 | **smoke emitter, narrow column** (lava); in Canada on the train | no | no |
| 102 | 1 | **fog emitter** at the foot of waterfalls | no | no |
| 103 | 1 | **smoke emitter, wide cloud** (lava) | no | no |
| 144 + n | 1 or 17 | **sound source** for `Sound/nn_*`; single triangle, invisible, can have a path | no | no |
| 150 | 0 | **collision object, light: the cones** (Austria 23, Iceland 9): the car kicks it away (see below); no light | yes | no |
| 152, 153 | 0 | **collision objects, very heavy / heavy** (USA 11 / 6): kicked away like the cones, with mass 8000 / 1500 (see below). With `flags1` = 1 (Brazil, Canada, Iceland: one face) they are not collision objects but sound markers of slots 8 / 9 (type word 408 / 409) | yes | no |
| 154 | 0 | **pylon/buoy with warning light**: a light collision object (kicked away like 150) that also flashes a `Light.tfx` sprite 20 above the point in a chaser (chapter 19); the mesh is the housing | yes | no |
| 200 | 0/16/32/48 | individual objects: trees, houses, signs, water surfaces | yes | no |
| 250 | 0 | **animation table** (see below) | no | no |

**Track sections (type 0–8)** (confirmed or observed):
- Every placement of type 0–8 is a **track section with gate** in `.TRI` (chapter 9). The surrounding terrain (meadow, rock, embankment) belongs to the mesh of the section. Landscape without gate exists only as type 50 and in a few placements appended later (Japan 420–428 and 442–448 with type 8: invisible walls with code 80 and an asphalt strip).
- The placement numbers of the track sections increase **in the driving direction**: type 1 has the lowest number of the lap, type 0 (start/finish) closes it. Canada: type 1 = placement 0, type 0 = 199. Japan: type 0 = 2, type 1 = 3; before that lie sections 0, 1 and 249 as the end of the lap.
- **Parallel paths are types 4 and 5** (observed in all seven levels, 15 forks): between a fork and its merge one path is entirely type 4, the other entirely type 5. Which path gets which type looked arbitrary (side, length in units or numbering) - the rule is the number of placements: type 4 is the path with more (or as many) placements, see the track walk below. The numbers of a path need not be contiguous: Brazil fork 82: path 4 = 83–84 and 218–230 (appended at the end), path 5 = 85–96, merge 97; USA fork 125: path 5 = 126–140, merge 141, path 4 = 142–158 after the merge. Game test (level editor): with type 2 on both paths, the path not numbered right after the fork showed "Wrong way" until the merge and the AI lost its way.
- **`.PLC` flags3 = 10 before forks:** on the 5–8 sections leading to a fork (fork included) in 13 of 15 forks (exceptions: Austria 14, Iceland 177; one run 222–224 in Austria without a fork). flags3 is the warning sign (chapter 7), 10 the fork sign. The other values announce bends, jumps and so on; flags2 is the camera offset (chapter 7).
- **Parallel tracks:** After the type 3 section (fork), first one branch is numbered through, then the other. The latter's first section again lies next to the fork. The type 6 section (merge) lies next to the end of the first branch. Example Canada: fork 33, branch 34–42, branch 43–61, merge 62. Each level has as many type 3 as type 6 sections (Austria 3, Brazil 2, Canada 2, Carib 1, Iceland 3, Japan 2, USA 2).
- **Forks and merges in the originals** (measured in Brazil): the through lane keeps its ordinary sections and gates right through the junction; the other path's sections take the wedge up to the lane's edge. Fork 82 (type 3): its gate is the last across the undivided road (380); behind it the joined surface is divided along the extension of that gate's end (x ≈ −5805): path 4 (83, 84, continued as 218–230) keeps the whole former road (gates 424, 544), path 5 (85 = a wedge of 2 faces with a gate of 466 from the division point outwards, 86–96) lies entirely beyond the line. Merge 48 (type 6): an ordinary section of the lane (gate 271 = lane width); the branch 53–57 comes in from the side, its last sections hold the wedge (4 drivable faces, gates 413–550); a branch car can pass the end of the merge gate without crossing it - the first gate both surely cross is 58 (type 2, full width). So gates may be skipped by the other path, and no gate lies over the other path's drivable faces (sampled). The level editor builds junctions this way; game test: forks and merges run, laps are counted, no crash (SimpleSplit, SplitJoins with three branches, MyThird).
- **Earlier junction placements of the level editor** (game tests): branch sections lying on the main road at the same height with placements of their own showed "Wrong way"; the junction cut into several sections each with a gate across its own road crashed the game at the merge (once it hung in a loop of one sound effect; "Wrong way" flashed just before) - whether because those gate lines ran over the other road's surface is a hypothesis, not established. The whole junction as one mesh with one gate ran (SimpleSplit, SplitJoins, MyThird), but its placement was up to eight sections long and the wall check failed at its far end (chapter 20, rule 9). A merge gate reaching only to one path's road edge was too short for the other path's cars (in the originals the merge gate is only the lane and the branch cars skip it).
- **The game builds the track order itself:** at level start every landscape placement's point is moved to the mean of the corners of its drivable faces (surface code below 40, not 5/6/7 modulo 10; all faces when it has none; the mesh is shifted to keep the world position), then the section table is walked geometrically, **not by placement number**: entry 0 is the type 0 placement; from the type 1 placement the chain always continues to the **nearest not yet visited placement of type 2, 3, 7 or 9** (distance sqrt(dx² + (2·dy)² + dz²) between the recentred points, so height counts double); after a type 3 (fork) it follows the chain of nearest type 4 placements until a type 6 is the nearest, then from the fork the chain of nearest type 5 placements until the type 6, and goes on from the merge; after a type 7 it continues to the nearest unvisited type 7 - **that is what the type 7 pair is for: it carries the walk across a jump gap longer than the distance to any other placement** (Canada 121/122, gap 1051). **Fork blocks in the section table:** the type 4 chain gets one table entry per placement after the fork's entry; the type 5 chain is then written **into those same entries** in order (each entry holds the type 4 placement and the paired type 5 placement with its heading), and a car on the type 5 path carries a negative section index. So the k-th type 5 placement is paired with the k-th type 4 placement, and **the type 5 chain must not be longer than the type 4 chain**: its surplus entries overwrite the merge's entry and the entries after it, and the AI crashes there (game test with the test level RPR1: 26 type 4 and 27 type 5 placements). This is the rule behind the originals' numbering: in every fork block the type 4 path has at least as many placements as the type 5 path (Canada 19/9, Carib 30/24, Austria 12/11, 22/21, 22/17, Iceland 13/11, 3/3, Japan 7/7, 16/4, USA 18/14; Brazil and USA count their appended path parts in). The level editor gives type 4 to the longer path of each block. Consequences: placement numbers only matter for types 0/1, the lightning sections and the `.TRI` header; the track must be laid out so that each placement's nearest candidate is its true successor - a stretch of track nearby (closer than the placement spacing, height counting double: stacked tracks, a helix), a merge nearer to a branch placement than its next placement, or a long jump gap without a type 7 pair sends the walk astray, and then the AI drives towards the wrong section, "Wrong way" shows and the AI crashes at the first fork (game test with RPR1: the walk skipped the landing of a 2500 gap). The level editor runs this walk on every compile ([`../editor/core/gameorder.js`](../editor/core/gameorder.js)) and reports where it leaves the intended order. Game test: RPR1_full (816 sections in 411 placements of two sections, three fork blocks, two jumps) runs three laps with the AI once the walk is consistent and type 4 is the longer path of every block.
- **Jumps** (level editor, chapter 17 for the codes): the road two sections before and after the gap gets the ramp code 10, a pit with deadly ground (110) lies under the gap; the sections next to the gap are a type 7 pair on the main road outside fork/merge blocks, and keep their path's type inside one (the walk there only follows types 4 or 5), as Carib's branch jumps do (103→104 and 122→123, gaps of 727 and 766, types 5 and 4; the car can even jump from one branch to the other). The originals' type 7 pairs (Canada 121/122, Brazil 202/203, Japan 111/112, USA 96/97) all lie on the main road outside blocks. An earlier test with type 7 pairs did not count laps (take-off 77, landing 104; not re-tested).

| Level | Start/finish (type 0) | first section (type 1) | Forks (3) | Merges (6) | Type 7 |
|---|---|---|---|---|---|
| Austria | 215 | 216 | 14, 45, 169 | 38, 93, 209 | – |
| Brazil | 1 | 2 | 33, 82 | 48, 97 | 202, 203 |
| Canada | 199 | 0 | 33, 173 | 62, 188 | 121, 122 |
| Carib | 156 | 157 | 89 | 144 | – |
| Iceland | 18 | 19 | 95, 142, 177 | 120, 151, 184 | – |
| Japan | 2 | 3 | 36, 221 | 51, 242 | 111, 112 |
| USA | 1 | 2 | 20, 125 | 53, 141 | 96, 97 |

Start/finish confirmed in the game in all seven levels.

**Detecting markers** (converter): `flags1 & 1` and exactly 1 face ⇒ sound source or emitter marker (95/102/103). `flags1 & 1` and all vertices with the same y ⇒ flat emitter (geyser).

**Collision objects (150-199):** the type the game works with is the type word `type + 256 × (flags1 & 15)` (the four bytes `type`, `flags1`, `flags2`, `flags3` at +4 of the placement record read as one int32, `& 0xFFF`; the high nibble of `flags1` is the visibility group) - so `flags1` bit 0 turns a type into a marker or special object (144 + n → 400 + n sound markers, 44-48 → 300-304 hitting objects). Placements whose type word is 150-199 are collision objects: the game sets each up with its position, a movement state at rest and two parameters, and knows only 150, 152, 153 and 154 - any other type in 150-199 stops the level with an error message (no info about the collision object). Every frame each standing object is tested against each car: height difference below 50, a box pre-test of 150, then the car's outline against a **fixed square of ±30 around the placement point**, whatever the mesh's size; on a hit the object is set moving (the mesh flies and turns with it). The two parameters enter the impulse as factor × … / mass: 150 and 154 0.3 / 100, 153 2 / 1500, 152 25 / 8000. The originals' collision objects have their point 4-40 above the ground (Japan once 175 below) and footprints of 18-95. They are only loaded while a game setting is on (forced on in one game mode); the hitting objects (300-349) and the avalanche (357) depend on the same switch. Level editor: Collision "Kicked away (light / heavy / very heavy)" = 150 / 153 / 152, the warning light = 154.

**Animation table (250)** (confirmed): An invisible mesh parked off to the side. Its faces list tiles in **face order**:

- **Face 0:** the tile used in the world.
- **Faces 0…n−1:** the animation frames that the game copies into this tile one after another.

Examples: Carib waves (16 frames), Canada river (6 tables at 4 frames each, one per river tile), Brazil/Iceland/USA water and lights (4, 7, 8 frames). Copies of the table geometry with a different type (Canada: brown fan with type 200) must not be drawn either.

**How the game uses a table:** at level load every placement of type 250 is registered; there is no fixed number of tables or frames. A frame is taken from every face whose flags byte is 0x11 or more and not 0x14: the tile is the face's first texel coordinate rounded down to a multiple of 64 and its texture (the texture offset's upper 16 bits), so only the face's uv and texture matter, not its shape or position. The game takes frames only from the texture memory up to texel 400 000 (about textures 0–5), so the frames should lie in the first textures. At play time a per-table frame counter advances and the current frame's 64 × 64 block is copied into frame 0's block, which the world faces show. The level editor writes a table for every texture strip named `<name>_anim` (n × 64 by 64 pixels; [`EDITOR.md`](EDITOR.md), Assets).

---

## 16. Face flags

Observed values: `0x11, 0x12, 0x13, 0x15, 0x16, 0x17`. Bit 4 (0x10) is always set.

| Bit | Meaning | Status |
|---|---|---|
| 0x01 + 0x02 together (0x13, 0x17) | **colour key + semi-transparent, 50 %** (tornado, light cones, fences, waves, fog); this value **is** taken from the file, on any tile (the per-slot table below only re-derives 0x11 / 0x12 / 0x15 / 0x16) | confirmed |
| 0x02 alone (0x12) | **colour key: palette index 0 is see-through** (trees, foliage) - but in the 3dfx game this flag is **not taken from the file**: at load every face with 0x11 or 0x12 (0x15 / 0x16 double-sided) gets its draw mode from a fixed table of the game **per level slot and tile number** (512 entries per slot, one per tile number = texture × 16 + tile): class 1 → 0x11 plain, 2 → 0x12 keyed, 3 → 0x13 keyed + blend, 4 → 0x18 (the slot's `.TFX` tiles). Keyed tile numbers: Canada 24, 28, 29, 31, 33, 91, 95, 99, 100, 101, 104, 105, 164, 207, 211, 212, 216, 217, 223, 234; USA 24 numbers (+ 8 keyed-blend 172–175, 180–183); Carib 15 (+ 16 blend); Brazil 13; Iceland 9; Austria 5; Japan 33, 34, 35, 119, 244 (level editor: `SLOT_TILES` in [`../editor/core/compile.js`](../editor/core/compile.js)). The colour key is the colour of palette entry 0. Game test: a Canada tree placed by the editor landed on tile 17 and showed black holes, on tile 95 in the original it is see-through; with the tree and a Japan gate on Canada's keyed numbers 24 and 28 both are see-through in the game (test level transparency_check) | confirmed (game test) |
| 0x04 | **double-sided**: the face is not dropped by the back face test (fences, masts, light discs, kerb tops in Iceland, many thin wall faces in Japan/Brazil) | confirmed by game test: thin kerb faces without 0x04 left holes at grazing angles, with 0x04 (0x15) they held |

**Exception** (observed): Faces with surface code ≥ 300 (objects) are drawn **opaque** despite 0x13/0x17 (Carib propeller cage).

---

## 17. Surface codes

The `surface` field of each face. Confirmed (encoding), observed (behaviour).

### Drivable: code < 78

```
Code = 5 · behaviour + material
```

| Material (code mod 5) | Rolling/skidding sound |
|---|---|
| 0 | asphalt |
| 1 | gravel/grass |
| 2 | mud |
| 3 | sand |
| 4 | snow (slippery by itself) |

| Behaviour (code div 5) | Codes | Meaning |
|---|---|---|
| 0 | 0–4 | normal |
| 1 | 5–9 | slippery, hardly any grip (Austria slope, Brazil landing area) |
| 2 | 10–14 | ramp / take-off edge (car may lift off) |
| 3 | 15–19 | acceleration (only Austria ski ramp, code 19) |
| 4 | 20–24 | **deadly if reached outside the gate order** (shortcuts, jumps that are too short) |
| 5 | 25–29 | unknown (Canada puddles, code 26; formerly taken for lightning targets, but the lightning does not depend on faces, chapter 19) |

### Not drivable: code ≥ 78

| Code | Meaning |
|---|---|
| 78 | effect/scenery: water, cloud, fog, shadow tiles; fences in Japan. Acts like a wall. |
| 79 | rock, walls. Acts like a wall (only near the placement point, chapter 20, rule 9). |
| 80 | scenery; **invisible wall, even if flat** (Canada rails, Japan airport) |
| 90 | scenery. Acts like a wall. |
| 110 | **deadly, always**: explosion, reset |
| 131 | **deadly, always**: water splash, reset |
| 300–305 | faces of objects that hit the car (type + 256: 300 train / truck, 302 lorry, 303 stones; the snowballs keep 90). The reaction comes from the placement type, not from the face code (the object's type word, chapter 15). Never become ground. |

**Edges between drivable and not drivable ground** (observed in the game with levels from the level editor): such an edge acts as a **wall**, even when the not drivable side is lower (a cliff, a pit), **unless the drivable face has behaviour 2 (ramp, codes 10–14)**: from a ramp face the car leaves the edge and falls (as at the jump take-offs of the originals). A cliff beside the road therefore needs a row of ramp faces between the road and the drop; deadly ground (110) far below the edge works as the floor. **The ground below and beyond the edge must not be a wall code:** a ramp-coded take-off floating in the air (no faces sharing its edge) over landscape of code 80, with no pit, stopped the car at the edge like a wall (test level RPR2; the ground under that gap painted deadly afterwards, game test pending). So the exception holds for drivable or deadly ground beyond the edge (tested: 110, drop edge 11), not for wall codes; assumed: the game checks the ground under the car's new position. The level editor warns per take-off edge where it finds only wall-coded or no ground behind it. Keep it shallow: the deadly floors of the originals lie at most about 830 below the road (median 50–380); a level with a floor up to 1115 below crashed and flickered once and ran after the floor was raised (not isolated further).

**A not drivable face with an edge on the road** stops the car like a wall even when the road is ramp-coded and continues beyond that edge (observed in the game with a level from the level editor): at the end of a free-standing bridge deck the cliff under the road's end hung from the road's cross line (a code 80 face from the road edge over the road's centre steeply down, its top edge across the road at road height) and the car stopped there; with the drivable code 10 on that face it drives on. The slope does not matter, so this is not the "drive onto a wall surface" case of chapter 20, rule 9. Assumed: the ground query picks the steep face right at the line (nearest face below the car), and a not drivable ground face is treated as a wall.

**Faces above each other** are fine: a road with a wall-coded ceiling 60 below it, the landscape and a second road 500–700 further down - the car stays on the top road (underpass and free-standing bridge of the test level MyThird). Terrain beside a bridge deck marked as drop edge (code 11) lets the car leave the deck and cut across below, as at the shortcuts of the originals (tested in the game).

**Interaction:** The collision geometry comes from `.SRF` (landscape) and the object hulls. Whether a surface is drivable, deadly or a wall is given by the surface code. "Deadly outside the gate order" additionally evaluates the progress through the `.TRI` gates.

---

## 18. Rendering rules

3dfx version. Confirmed or observed.

**Dropped triangles:** a triangle is dropped when it lies outside the screen rectangle, when the sum of its three camera depths is ≤ 600 (mean depth ≤ 200: no clipping at the near plane, the whole triangle disappears), and by the **back face test**: the cross product of the integer screen coordinates (xor a mirror flag) ≤ 0. Thin faces or faces seen at a grazing angle can fail the back face test by rounding; give them face flag 0x04 (chapter 16).

**Drawing order:** no depth buffer; back faces are removed in software. Every primitive goes into an **ordering table** of 6000 buckets: triangles by `(z0 + z1 + z2) >> 4` (camera depths of the three vertices), points by `3z >> 4`, clamped to 0..5999, inserted at the head of the bucket's list; drawn far to near, each bucket from the head, so on equal buckets the triangle inserted later (later placement, later face in the mesh) is drawn first. Primitives of objects (assumed: placement type ≥ 100, so objects 144+, 150–154, 200, 250) are moved 92 buckets nearer (76 for some primitive types, 84 for type 210): objects are drawn over the ground around them. Consequence for new levels: a small raised part (kerb) next to a large flat triangle is painted over when that triangle's mean depth is nearer, e.g. a ground triangle with two vertices at the near end of a section behind a kerb triangle with two at the far end. Remedy used by the level editor: regular strips with the same diagonal.

**Placements are drawn only while their point lies in a window around the camera** (first seen in the level editor's test level OneMoreTest, where landscape belonging to placements with points 3300 to the side of the camera was not drawn at all - black, flickering at the border - although it reached to within 2500). All placements of types 0–8 and 50 are kept in a grid of 256 × 256 cells by their position. Each frame the renderer collects the objects of a fixed set of cells (20 rows of 8–20 cells, a disc about 20 cells = 5120 across) whose centre lies 8 cells (2048) ahead of the camera in its view direction (32 directions); so a placement is drawn when its point is within about 4600 ahead, 2560 to either side and 512 behind the camera. Its mesh is drawn whole, however far it reaches. The window is anchored to the camera, not to the car (the camera's position and horizontal heading, the heading rounded to one of 32 directions): a camera set further behind and above the car (tested in the game: a camera distance of −300 relaxes the flicker of far landscape a lot) moves the disc back with it and tilts the view down, so the car sits deeper inside the disc and less of the disc's far edge is in the picture. Nothing in the level changes the window's size. Visibility groups (`flags1` 16/32/48, chapter 7): when the current track section's group is not 0, objects whose group is set are only collected if it matches. At most 1500 visible objects per frame. In the originals every landscape vertex within 1200 of a track placement's position belongs to a placement whose point is at most 3150 away (Austria; Canada, Carib, USA at most 2300), so the limit never shows there. Measured in the originals: of all landscape vertices within 2500 of a track placement's position, at most 158 per level (Austria; 0 in Carib and USA) belong to a placement whose point is more than 3500 away - so holes of this kind never show there. Consequence for new levels: landscape near the track belongs to a placement whose point is within the window from every place it is seen (in practice within about 2500 of it, and not far behind); the ground between two stretches of track goes into placements of its own (type 50) with points in its middle; backdrop far from the track may belong to a far placement as the originals do (it appears with that placement) (chapter 20).

**General**
- Unshaded: output palette colours directly, no lighting.
- **Palette index 0 is transparent on faces the game draws colour-keyed** - decided per tile number from a fixed table per level slot, or by flag 0x13 / 0x17 (chapter 16; earlier taken for all faces, then for flag 0x02) (fences, trees, grids, windows).
- **One-sided:** Back faces are not drawn. Front face = vertices wound **clockwise** as seen from outside, in the game coordinate system (with y down) viewed as right-handed. Checked on 100 closed bodies. After conversion `(x, y, −z)` into a Y-up system also clockwise, so `BackSide` or reversed indices. Signs therefore consist of two coincident, oppositely oriented faces (front and back).
- Transparency: see chapter 16.
- **Bilinear texture filter:** the textures are 256 × 256, without mipmaps, wrapping, with bilinear filtering. The colour key value is the RGB of palette entry 0 of the `.COL`, and the key is tested on the **filtered** colour. Consequences: a keyed tile shows a dark fringe (a mix with the black of index 0) around its visible texels, as the originals' trees do; and a face whose uv reach a tile's edge mixes in the neighbouring tile of the texture, which on a keyed tile shows as a line along the tile lattice (seen in the game: a transparent road of the level editor, test level RPR2). The originals keep their uv about 2 texels inside the tile (1.92..62); the level editor keeps the pieces of the user's textures 1 texel inside (uv 1..63; game test: the lines are gone).

**Effect tiles** (faces with code 78 or tiles from animation tables)
- Recolour raw values in `.TEX` via `.TFX` (chapter 5).
- **Fog:** Tiles consisting only of indices **144–153** (and 0) are fog. Density = index − 144 (0–9). Draw as light grey with opacity ∝ density (Viewer: at most ≈ 67 %).
- **Cloud shadows:** Effect tiles that are very dark after recolouring (mean brightness < 40) and lie mostly horizontal are shadows. Draw as semi-transparent black (≈ 45 %) over the ground. Brazil only.
- **Shadows of moving objects:** Faces with code 300 inside a mesh that mostly has other codes are the flat shadow silhouette (Japan aeroplane). Draw like cloud shadows.

**Do not draw**
- Markers (sound sources, emitters)
- Animation tables (type 250) and copies of their geometry

---

## 19. Runtime effects

These effects are only present as triggers in the data. The game produces their appearance itself; the parameters are estimated from videos.

| Effect | Trigger in the data | Implementation in the Viewer |
|---|---|---|
| Tile animations | animation tables (250) | copy frames into the tile one after another, ≈ 13 frames/s (from video) |
| Waterfall mist | marker 102 | `Smoke.tfx`, additive, 25 %; 5 puffs per emitter, 6 s lifetime, first resting, then rising |
| Lava smoke wide | marker 103 | like 102, but `Darksmok.tfx` multiplicative, 90 % |
| Lava smoke narrow | marker 95 | `Darksmok.tfx`, 8 puffs, 2 s, narrow, rising immediately |
| Geysers | emitter 49 | every 4 s a burst of 6 small `Smoke.tfx` puffs, rising fast |
| Warning lights | type 154 | chaser light over **all** such objects **in `.PLC` order**: at level load the game gives every object of type 154 or 150 a phase (4 per object, wrapping at 30) and the parameters 0.3 / 100; per frame the object whose phase is due spawns effect 1 - a `Light.tfx` flash (three variants: first, middle, last of the run) **20 above the placement point**; additive, 50 %. The flash is the sprite's own white-yellow (grey ramp of `sys.col`); nothing in the level colours or sizes it, the mesh (Canada: 10 faces, 22 × 50 × 24) is only the lamp housing. Only type 154 flashes, so Austria's 23 cones (type 150) have a phase but no light; Canada / Carib / Japan use 154 (23 / 24 / 53). The parameters 0.3 / 100 (and 25 / 8000, 2 / 1500 of types 152 / 153) are not light parameters but the collision objects' factor and mass (chapter 15) |
| Lightning | **none: fixed for the Canada slot** (see below) | every 3–9 s a lightning bolt into a random code 26 face, white jagged band ≈ 0.1 s, then a `Darksmok.tfx` cloud; sounds `THUND`/`LIGHT` |
| Ambient sounds | marker 144 + n | positional sources, possibly on a `.POS` path |
| Moving objects | `.POS` | chapter 8 |

**Weather by level slot:** the game sets a weather number from the level slot (slot order: 0 Canada, 1 USA, 2 Carib, 3 Brazil, 4 Austria, 5 Iceland, 6 Japan): Canada 1, Austria 2, USA 3, all others none. Each weather is active while the player's car is on a fixed range of track sections (the number is the car's index in the game's section table, which is built along the track at level start (chapter 15): each entry holds the placement number and the placement on the parallel path, a negative index means the parallel path; for a track whose sections come first in driving order the index is the placement number. Lightning was observed in Canada from about section 63 to 123, which fits a first strike some time after 46 and strikes up to 3 sections ahead): Canada 46–119, Austria 29–99, USA 1–29. With weather 1 (Canada) a lightning strikes with a chance of 1/200 per update: at the section of the car or up to 3 sections ahead, at the first gate point of its `.TRI` record (cache coordinates) ± 100; the strike itself is a flash of the screen colour, sparks and smoke. Weather 2 is **snowfall** (observed in Austria on these sections). Weather 3 (USA) showed nothing visible in the game; for weathers 1 and 3 the game starts a looping sound per player at level start (assumed: rain or wind ambience), the visible effects exist only for weathers 1 and 2. Consequences: the lightning depends neither on the faces nor on the placement flags; **every level installed in the Canada slot gets it on its sections 46–119**. Ways round it: another slot, or no track section with these numbers: the level editor can give placements 46–119 to invisible filler objects (one triangle without area, type 200) and number the track on from 120 (the originals have shorter gaps of other placements between track sections: Brazil 214–217, Austria 47–49 and 78). **Game test: the level did not start with these fillers** (MyThird; started without them), so the editor no longer writes them by default.

The emitters have no start phase in the data. Start adjacent emitters staggered (Viewer: phase from the placement number).

---

## 20. Consistency rules for new levels

What a new level must satisfy so that all cross-references are correct:

**Palette and textures**
1. `.COL` with header as in chapter 3. Either take over the palette of an original level unchanged and map the textures onto it (with its `.SHD`/`.TAB`/`.PAN`), or an own palette: index 0 for "transparent", **0–3 and 160–255 from an original level**, own colours in 4–159, `.SHD`/`.TAB`/`.PAN` transferred (chapter 11). Both tested (own colours reduced to 156 via median cut if needed). The level editor uses only plain colours: texture 0 is a grid of 16 × 16 cells with one palette colour each, and a face points all three corners into one cell ([`../editor/textures.js`](../editor/textures.js), [`../editor/core/palette.js`](../editor/core/palette.js); not yet tested in the game).
2. `.TEX` in 256×256 blocks, **at least 16 textures** (otherwise light grey tyres, chapter 4); unused textures may have any content. Faces should not exceed a 64×64 tile if they are to be animated or recoloured.

**Geometry**
3. `.MSH` without gaps. `meshOffset` in `.PLC` = dword offset of the mesh header.
4. **One placement per mesh** (as in all original levels). `.POS`, `.TRI` and `.SRF` refer via the placement number.
5. Model mesh vertices locally with **y down**; placement position with **y up**.
6. Front faces clockwise (chapter 18). Transparency only via index 0 on the slot's keyed tile numbers (chapter 16; the level editor's `SLOT_TILES`), or index 0 plus flags 0x13/0x17 for colour key with 50 % blend on any tile.

**Collision and track**
7. Give every face a surface code according to chapter 17. Roadway < 78, walls and scenery ≥ 78, death zones 110/131.
8. **Create the track sections in driving order** as the first placements: the first section after start/finish with **type 1**, the section with the start/finish line with **type 0** (exactly one each), type 2 in between. Without type 0/1, the game crashes at level start (observed). **No placement of type 0–8 without a gate**: terrain with type 2 and a zeroed `.TRI` record does not crash, but "Wrong Way" appears when driving off, no lap counts, and the computer opponents turn towards the point where the zeroed gates lie (observed). Assumed: the game also reads these records as gates. **Everything drivable belongs in the mesh of the track sections:** The race position is derived from the placement under the car. On drivable terrain of type 50 you are immediately last (observed, test level Ring D2). Use type 50 only for non-drivable parts, as in the originals. **Forks and merges as the originals** (chapter 15): the through lane keeps its sections and gates, the other path's sections take the wedge up to the lane's edge, the fork section's gate covers the undivided road, the merge section is an ordinary lane section; no gate over the other path's faces. Road markings as extra faces of the road (thin strips lying in the road's plane) crashed the game (cause unknown: not the face count); as type 200 objects they run but are drawn over the car and the kerbs (chapter 18: objects are moved 92 buckets nearer). Markings therefore belong in the road texture, as in the originals.
9. **Cut track sections along the driving line, put the placement point in the middle of the roadway.** The boundary between drivable ground and wall code (78/79/80/90) acts as a wall only if it lies near the placement point of its mesh (observed). This is how the originals do it:
   - The placement point of every track section lies on the roadway: seen from above, in 94 % of all sections it lies over a drivable surface of its own mesh (Brazil, Carib, Iceland, Japan: in all of them), otherwise mostly just beside it (Austria at most 397, Canada 478). The points thus line up along the driving line, including across forks and shortcuts; parallel tracks always have separate meshes with their own points. This does not depend on the gates (`.TRI`), which only serve AI, lap counting and "Wrong Way".
   - The meshes themselves may be large (median 500–850 around the point, some up to 6807), but the roadway edges and the walls beside them lie near the point (wall edges at most about 890 away).
   - Test levels: Ring I (point above the road, wall edges at most 540 away): walls work. Ring A–H (point in the terrain, 293 beside the nearest drivable surface, wall edges up to 2900): you drive onto the wall surface, fly up or explode.
   - The exact limit is unknown. Assumed: the ground query runs via `.SRF`, the wall check only against placements near the car.
   - Terrain out of reach (behind walls) can be created as type 50. Without influence on the walls are slope, surface size, winding order, `.SRF` cell assignment, `.TRI` angles and the `.PLC` bytes `flags2`/`flags3`. Very long, pointed triangles are drawn incorrectly (Ring E).
   - **Landscape near the track belongs to a placement whose point is within the drawing window from where it is seen** (chapter 18: about 4600 ahead, 2560 to the side, 512 behind the camera). The ground between two stretches of track: own placements of type 50 with the point in their middle (level editor: cells of 1200 beyond 800 of every track point).
   - **Counts:** the game sizes its memory by the files (`.PLC` tables by the placement count, `.TRI` by count × 500, `.SRF` and `.MSH` whole), so no fixed limit there; fixed are the section table of 1500 entries for placements of types 0–8 and 50, the AI table of 1500 entries and the per-frame list of 1500 visible objects (chapter 18). **The real limit is the object pool: 1500 objects** (one object per placement of any type), of which particles take **700**, the cars with wheels, shadows, names and the effects more; when the pool runs dry the game writes "Error while creating the world" or "Maximum of objects reached!" to its log and exits. Tested in the game with levels from the level editor: a level with 497 placements ran, 582 did not - so **about 500 placements** are available; the originals stay below 451. A long track therefore puts several sections into one placement (level editor: up to 3, placements of about 500–750 units; the wall rule 9 bounds that).
   - **Bridges and crossings at different heights** (level editor, game tests): both roads are ordinary track sections of their own paths; the upper road gets an underside 60 below it (its "ceiling") and vertical faces along its edges, the lower road runs under it (as a tunnel with walls through a hill, or under a free-standing deck with the landscape running on below). The game drives both (the race position follows the placement under the car). Nothing wall-coded may have an edge on the road (chapter 17): give the deck's underside, its fascias and the landscape hanging from the deck's end lines a drivable ramp code (10), and mark the edge rows beside the deck as drop edge (11) where the car may leave it.
10. Regenerate `.SRF` from all faces of the landscape placements (type 0–8, 50): each face in two halves (anchor at the z-minimal corner ⇒ list B with `h > 0`, at the z-maximal corner ⇒ list A with `h < 0`), `s1` left and `s2` right edge as dx/dz in 16.16, enter face address and placement · 42, sort into all covered 512 cells. Header: 200, 200, 512, 512, 101, 101, nRec, nA, nB.
11. `.TRI`: one 500-byte record per placement, zeros for non-track parts. For track sections: byte 0 = surface code of the roadway, two gate points at the **entry edge** of the section (vertex index + cache coordinates, A outside, B inside when driving anticlockwise), D0–D5 = π/2, D6 = gate direction `atan2(zB − zA, xB − xA)`, D7 = D6 ± π, rest zeros. Header = number of gates (with gaps in the numbering: the number of the last track section + 1; the originals never have less, Brazil exactly that). Generated this way, the level runs including computer opponents (test level Ring A: 48 sections, header 48).

**Animation and effects**
12. `.POS` with one table entry per placement (−1 = static).
13. Create water and light animations via an animation table (type 250), face 0 = world tile.
14. Sounds as marker 144 + n with a matching `Sound/nn_*` file. Emitters as markers 95/102/103 or as a flat quad with type 49. Lightning is not in the data: it comes with the Canada slot (chapter 19).
15. Pylons with warning light: type 154, the first 4 faces = light disc. The order in `.PLC` determines the chaser light.

**Heights for orientation** (measured in all seven levels, world y up as in the level editors; landscape = all meshes of types 0–8 and 50, roadway = the drivable faces of the track sections): the absolute height does not matter to the game (only the ±25000 limit of chapter 20, rule 9 is known), the levels lie anywhere between −1600 (Carib) and +360 (USA) on average. The landscape rises typically 500–1500 above the highest roadway (scenery) and reaches up to about 1000 below the lowest (drops, deadly floors at most about 830 below the road, chapter 17).

| Level | Landscape min..max (span) | Roadway min..max (span) | Roadway mean | Deadly ground min |
|---|---|---|---|---|
| Austria | −1593..679 (2272) | −1409..241 (1650) | −595 | −1015 |
| Brazil | −3186..1241 (4427) | −2033..700 (2733) | −588 | −2210 |
| Canada | −282..1713 (1995) | −251..545 (796) | −5 | −255 |
| Carib | −2173..−646 (1527) | −1877..−1128 (749) | −1611 | −2173 |
| Iceland | −1393..1122 (2515) | −719..735 (1454) | −109 | −511 |
| Japan | −874..446 (1320) | −727..−63 (664) | −426 | −685 |
| USA | −415..1480 (1895) | −18..1196 (1214) | 358 | 467 |

**The game's log:** `Default.fil` in the game directory (rewritten at every start): "Ignition version 6.53 initiated", then error messages such as "Error while loading …", "Error while creating the world", "Maximum of objects reached!" or "Out of memory, please refer to the manual!" before the game exits with code 1. Read it first when a level does not start.

**Reference implementation:** the level editor ([`../editor/core/compile.js`](../editor/core/compile.js), [`../editor/core/formats.js`](../editor/core/formats.js)) generates tracks that satisfy the rules of this chapter; a generated test level "Track 1" (151 track sections, canyon with walls, height undulations) ran completely, with walls, AI and lap counting, as did the simple circuit "Ring I".

**Take over:** `.TAB`, `.SHD`, `.PAN`, `.PIC` can be copied from an original level as long as only the 3dfx version is used.

---

## 21. Open questions

| Topic | Status |
|---|---|
| `.TRI` first dword, doubles D0–D5 | unknown (angles ±π); not needed for new levels (π/2 and gate count work) |
| `.TRI`: does the game read the doubles, or does it recompute them? | open |
| Placement types 2/8 | difference unknown; 4/5/7 clarified by the track walk (chapter 15) |
| Appended type 0–8 placements without a valid gate (Japan 420–428/442–448 type 8, Iceland 199/200, Carib 330/336, Japan 450) | levels run anyway; unlike test level Ring C, they contain garbage instead of zeros, and there are only a few |
| Wall check | works only near the placement point (chapter 20, rule 9); the point is the mean of the drivable faces' corners (chapter 15, the track walk); exact limit and mechanism unknown, about 540 works, 620 did not |
| Code 78/79/80/90 on walls | all act as walls in the originals; only 80 checked in the test level |
| Sorting when drawing | clarified (chapter 18: ordering table by mean depth, no depth buffer) |
| `.PLC` `flags1` visibility groups (16/32) | the renderer compares an object's group with the current section's group when that is not 0 (chapter 18); what the originals use it for is not examined |
| `.PLC` `flags3` sign 16 | meaning taken from the sign sheet (wrong way), not seen in the game |
| Edge to not drivable ground | ramp faces (10–14) let the car fall off; whether other behaviours (e.g. 20) do too is untested. A not drivable face with an edge on the road stops the car even next to ramp faces (chapter 17); the mechanism (ground query?) is assumed |
| Crash at a merge with gates of both paths over the joined surface | observed with the level editor's earlier junctions (chapter 15); one mesh with one gate ran. Hypothesis: a gate line running over the other path's surface; not established (the gate direction, very short gates at the nose or the section order are alternatives). The originals never have one, so building like them avoids the question; built like them, the levels run |
| Road markings as road faces | crash the game (chapter 20, rule 8); cause unknown |
| Jumps built by the level editor | the car jumps and laps are counted (RPR1_full, type 7 pair on the main road); type 7 clarified (the track walk, chapter 15) |
| "Wrong way" at a merge | flashes when a car arrives from the type 5 path (RPR1_full); the car carries a negative section index there (chapter 15); what is compared is unknown |
| Tracks stacked over each other | the track walk weighs height double, the gates are lines in the plan and the placement grid is flat; a helix with turns 250 apart ran but glitched (RPR1_full) |
| Weather 3 (USA, sections 1–29) | no visible effect; probably only an ambient sound (chapter 19) |
| Deep deadly floors | a floor ~1100 below the road crashed/flickered once; limit and cause unknown |
| Transparency (3dfx) | solved (chapter 16): colour key per tile number from the game's fixed per-slot table, or flag 0x13 / 0x17; game test with a Canada tree and a Japan gate on the Canada slot's keyed numbers: see-through |
| Code 78/79/80/90 | driving physics the same (wall); difference unknown (assumed: camera, rendering) |
| Collision of individual objects (type 200, 154) | not in `.SRF`; probably bounding volumes computed by the game |
| `.TAB`, `.SHD`, `.PAN`, `.PIC` | only roughly classified |
| `*conv.tab` | format clarified (chapter 11); name formation and use open |
| Own palette | works (chapter 3); not checked individually whether 1–3 must be kept free and the tables must be transferred |
| Tyres and 16 textures | mechanism assumed (car textures behind 16 level textures); Iceland has 17 |
| Mapping `.TFX` → `.TEX` | not stored; reconstructed (chapter 5) |
| Frame rates, emitter parameters, blend modes | not in the level data (fixed in the game); values estimated |
| `Ghosts/*.GST` | not examined (recorded runs, suitable for checking the gates) |
| Scale (units → metres) | not determined; can be calibrated via `CARS/Cars.msh` |
