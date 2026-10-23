# Ignition Level Tool

A 3D level viewer and a level editor for **Ignition**, the 1997 top-down racing game by Unique Development Studios.

- **Viewer:** shows the original tracks in the browser with their textures, animated textures, moving objects, fog and cloud shadows. Overlays show checkpoints (gates), collision surfaces, placements and sound sources. Any level can be downloaded as an OBJ file with textures, for Blender or other 3D programs.
- **Editor:** builds new tracks from control points: road, verge and kerbs, branches, jumps, tunnels and bridges, landscape, painting with colours and your own textures, objects from the original levels, sounds and moving objects. It compiles the level into the game's file format and can install it into the game in place of an original track. The original is kept and can be restored.
- **Format documentation:** [docs/LEVELFORMAT.md](docs/LEVELFORMAT.md) describes the level files (meshes, placements, textures, gates, collision) as far as they are known.

> This is an unofficial fan project. It is not affiliated with or endorsed by the makers or the publishers of Ignition. **It contains no game data:** the viewer and the editor read the levels, textures and sounds from your own installed copy of the game, on your computer, at runtime.

## Installation

You need:

- A copy of **Ignition**, any version (see [Game versions](#game-versions)). The Steam version is the easiest, because the tool finds it by itself.
- **[Node.js](https://nodejs.org/) 18 or newer.** Use the "LTS" installer from nodejs.org and keep its default settings. Nothing else is needed: no packages, no build step, no Python.
- A current browser (Chrome, Edge or Firefox) with WebGL.

### Windows

1. Get this repository: on GitHub click **Code → Download ZIP** and unpack it to any folder, e.g. `C:\Tools\IgnitionLevelTool`. (Or `git clone` it.)
2. Double-click **`viewer.bat`** or **`editor.bat`** in that folder. Windows may ask whether to run a file from the internet; allow it.
3. The first start looks for Ignition in your Steam libraries. If it is not found there, the browser shows a page where you type in or pick the game directory: the folder that holds `LEVELS` and `sys.col` (a folder one or two levels above it works too). The choice is stored in `data/config.json` and can be changed later (editor, Deployment tab → *change*).

### Other systems (Linux, macOS)

The tool is plain Node.js and should run there too, but it has **not been tested** on other systems yet, so expect some rough edges:

1. Get this repository as above.
2. In a terminal, in the tool's folder, start `node editor/server.js --viewer` (viewer) or `node editor/server.js` (editor). The browser opens by itself; if not, open the address shown in the terminal.
3. Steam is not searched automatically. The browser shows the setup page, where you enter the game directory: the folder that holds `LEVELS` and `sys.col`.

How you run Ignition itself on these systems (DOSBox, Wine, …) is up to you. Installing a level writes into the game directory you entered.

**Updating:** download the new version and copy your `data` folder into it.
**Uninstalling:** restore any original level you replaced (see below), then delete the folder. The tool writes nothing outside its folder, except when you install a level into the game.

## Usage

- **`viewer.bat`** starts the viewer with the original levels on http://localhost:8765/
- **`editor.bat`** starts the level editor on http://localhost:8767/. Its *Show in viewer* button (Deployment tab) opens the viewer with the level you are editing, next to the original levels. It does not need to be saved first.

The console window shows the address. Closing the window stops the tool. Starting a tool that is already running just opens the browser again.

Without the batch files: `node editor/server.js` for the editor, or `node editor/server.js --viewer` for the viewer. Options: `--port <n>` and `--no-open`.

The editor is described in [docs/EDITOR.md](docs/EDITOR.md).

### Your data

Everything you make stays inside the tool's folder, in `data/`:

| Path | Content |
|---|---|
| `data/config.json` | the game directory and other settings |
| `data/levels/<name>/` | your levels (`level.json`, plus your own sounds and reference images) |
| `data/textures/*.png` | your own textures. The editor picks up new or changed files within two seconds |
| `data/out/<name>/`, `data/out/<name>.zip` | compiled levels, ready to copy into the game or to share |

Back up `data/levels` and `data/textures` to keep your work.

**Installing a level** (editor, Deployment tab) replaces one original level folder of the game (Canada by default). The original is moved to `LEVELS\<slot>.org` the first time and stays there. To restore it, delete the level folder and rename `<slot>.org` back.

**Sharing levels.** What you would hand on depends on the form:

- **A compiled level** (`data/out/<name>.zip`, or the folder installed into the game) always contains files of the original level it replaces, whatever you built:
  - its preview picture (`.PIC`)
  - its sound files, except the slots you filled with your own sounds
  - its effect colours (`.TFX`, 3dfx version)
  - colour tables derived from it

  Objects you placed from the original levels (Assets tab) are in it too, with their geometry and texture tiles. So a compiled level is never free of original game content. It is meant for your own installation.
- **The level's source** (the folder `data/levels/<name>/` plus the PNGs from `data/textures/` it uses) holds only your own work: track, landscape, painting, your own textures, assets and sounds. The exception is objects from the original levels, whose geometry is copied into `level.json`. Reference images are whatever you loaded yourself. Someone with their own copy of the game puts the folder into their `data/levels/` and compiles it there, from their own game files.

This describes what the files contain. It is not legal advice.

### Game versions

Ignition exists in two versions with the same level files:

- the **DOS version** with a software renderer. This is what Steam sells today, running in DOSBox.
- the **Windows/3dfx version** for 3dfx graphics cards (from the original CD). Its levels have one extra file each, `<LEVEL>.TFX`, with the colours of the effect textures (water, clouds, fog), and the `GENERAL` folder has extra `.tfx` sprites.

Both work with the tool, with these differences:

- **Viewer:** with the DOS version's files, the effect textures are shown with their raw colours. This is most visible on the water of Carib. Brazil's cloud shadows and the smoke, warning light and mist sprites are left out.
- **Editor:** levels compile from both versions. All tests in the game so far were made with the **3dfx version**. Whether the editor's levels also run in the DOS version is **not tested yet**.

## How this project came about

My best friend and I have been playing Ignition in split-screen for more than 25 years. Sometimes he is better, sometimes I am. Some tracks suit him, some suit me. It is a gripping game, and it carries a lot of personal emotions.

I have been programming for almost 40 years, privately and professionally. There was hardly a time when I wasn't thinking about some program or project, and I spent many nights coding. Almost overnight, that is gone: AI can now do much of it better and faster. Even small test programs look good and are full of features. That scares me a little, and above all I miss my hobby.

At the same time I am torn. Suddenly the limiting resource is no longer my time, my skills or how fast I can learn. Almost anything realistically imaginable has become possible. A first 70 % solution is often there within minutes or hours of the first prompt. That is huge, and it is not going away. So we have to learn to live with it.

This project is one of those old ideas: a parser and renderer for the Ignition levels. Years ago I had half-heartedly decoded at least the textures and palettes. This time all it took was *"Here is an old game, the levels are 3D and in separate directories. I need a browser-based viewer for them."* Less than 20 minutes later I was looking at top-down views of the levels.

Working out the details of the level format, bringing in the animated objects and making everything look good and run reliably still took some work. But it was only a few evenings and a few prompts.

The same with the editor. Why not go one step further, why not a complete level editor? Again, half of it was done right away. The rest (and there is still plenty of room for improvement) was more laborious. Still: I would never in my life have taken this project to its current state if I had had to do it all on my own. And why would I? My motivation would not have lasted half the way, the audience is too small and the benefit too modest. I tend to lose interest in my private projects once the exciting problems are solved. That is exactly where AI helps: it builds the remaining 20 % in one or two evenings.

Nearly all of the code and documentation in this repository was written by an AI coding assistant ([Claude Code](https://claude.com/claude-code) by Anthropic). My part was the idea, the direction and the decisions, and the testing. Every test level was installed and driven in the real game, and what happened there decided the next step: what crashed, what flickered, which wall the car drove through, where the AI drivers went wrong. Many rules in [docs/LEVELFORMAT.md](docs/LEVELFORMAT.md) exist only because a test level broke in exactly that way.

I am curious what comes next, and what my job and my hobby will look like in the future.

## Known flaws and limits

This is an experimental project. Levels made with the editor run in the game, including AI drivers, lap counting, branches, jumps, tunnels and bridges. But neither the game's renderer nor the level format is fully understood, and it shows:

**Triangle visibility.** The game has no depth buffer. It sorts triangles by their mean distance to the camera and paints them far to near, so a large flat triangle can be painted over a small raised one next to it (e.g. ground over a kerb). It drops triangles whose screen-space winding rounds the wrong way (thin triangles, grazing angles) and triangles very close to the camera instead of clipping them. The editor's meshes are built to avoid these cases as far as known, but triangles can still vanish, flicker or show through in places.

**The draw window.** The game draws a level piece only while its placement point lies in a window around the camera. Landscape belonging to a far placement is not drawn at all. The editor assigns the landscape to nearby placements, but at the edges of large flat areas you may still see black gaps or flicker.

**Overlapping geometry.** Corners are not mitred, so the inside of a tight corner overlaps itself. Road markings show through the car and the kerbs. Kerbs stop before junctions. Track stacked over itself (a helix) glitches when the stretches are close. Long thin landscape triangles are drawn badly by the game.

**Missing or unknown.** Some fields of the level files are still unknown or only guessed (see "Open questions" in [docs/LEVELFORMAT.md](docs/LEVELFORMAT.md)). For example, why walls only work near a placement point, the meaning of some placement types, and the software renderer's tables. See also "Known limits" in [docs/EDITOR.md](docs/EDITOR.md).

**The viewer is an approximation.** It uses a modern renderer with a depth buffer, so it does **not** show the game's sorting problems: a level can look right in the viewer and still flicker in the game. Fog and shadow opacities, animation speeds and effects are estimated.

**Other limits.** A custom level replaces one of the seven original tracks (one at a time per slot). The editor's levels have been tested in the Windows/3dfx version of the game only (see [Game versions](#game-versions)), and the tool itself is tested on Windows only (see [Other systems](#other-systems-linux-macos)).

## Project layout

| Path | Content |
|---|---|
| `editor/server.js` | the local server for both modes (Node, no dependencies) |
| `editor/core/` | the editor's core: data model, track and terrain, the compiler that writes the game files |
| `editor/public/` | the editor's browser app and the setup page |
| `viewer/` | the viewer page, `convert.js` (reads a level into viewer data and OBJ), `gamefiles.js` |
| `docs/` | the editor manual and the level format |
| `editor/test/` | tests: `node editor/test/core.mjs`, plus browser tests through headless Chrome in `editor/test/tools/` |

## License

The code of this project is released under the [MIT License](LICENSE).
It includes [three.js](https://threejs.org/) (`editor/public/vendor/`), © three.js authors, also under the MIT License.
Ignition and all of its content are the property of their respective owners.
