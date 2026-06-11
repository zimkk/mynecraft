# VoxelCraft

A Minecraft-style voxel game built from scratch with **TypeScript + Three.js + Vite**. Everything — chunk meshing, terrain generation, AABB physics, voxel raycasting, save system — is hand-written; the only runtime dependencies are `three` and `simplex-noise`.

## Run it

```bash
npm install
npm run dev      # → http://localhost:5173
```

`npm run build` type-checks and produces a production bundle in `dist/`.

## Controls

| Input | Action |
|---|---|
| Click | Capture mouse (Pointer Lock) / start playing |
| `WASD` | Move |
| Mouse | Look |
| `Space` | Jump (hold to fly up while flying) |
| `Space` ×2 or `F` | Toggle fly mode |
| `C` | Fly down |
| `Ctrl` / `Shift` | Sprint |
| Left click | Break block (hold to repeat) |
| Right click | Place block (hold to repeat) |
| `1`–`9` / scroll wheel | Select hotbar block |
| `F3` | Debug overlay (position, chunk, facing, triangles, time) |
| `Esc` | Pause menu (settings, new world, export/import, reset) |

## Features

- **Infinite procedural terrain** from layered simplex noise (seeded — same seed, same world), with hills, beaches, and water, streamed in around the player and unloaded behind them.
- **Web Worker terrain generation** — chunk block arrays are built off-thread and transferred (zero-copy), so exploration never hitches the frame rate.
- **Face-culling chunk mesher** — only exposed faces are emitted (including across chunk borders), one `BufferGeometry` per chunk per pass (opaque + transparent), with Minecraft-style directional shading baked into vertex colors.
- **Runtime-generated texture atlas** — 16×16 pixel tiles painted into a canvas at startup, nearest-neighbor filtered, with per-face tiles (grass top/side, log bark/rings, …).
- **First-person physics** — axis-separated AABB collision (slide along walls, land on blocks), gravity, jumping, sprint, fly/no-clip mode.
- **Mining & building** — DDA voxel raycast (Amanatides–Woo) for block targeting with a wireframe highlight; placing never overlaps the player; edits re-mesh affected chunks (and border neighbors) instantly.
- **Day/night cycle** — orbiting sun, sky/fog color blending through dusk, dim nights; distance fog hides chunk pop-in and tracks the render-distance setting live.
- **Persistence** — world is saved as *seed + player-edit delta* (tiny saves) to localStorage with autosave; JSON export/import; new world by seed; reset.
- **Performance** — per-chunk frustum culling (Three.js per-mesh culling over chunk-sized geometries), budgeted re-meshing, worker generation. Holds 60 FPS+ at default render distance.

## Architecture

```
src/
  core/        Game (fixed-timestep loop + rAF render), Input (keyboard/mouse/pointer-lock)
  world/       BlockRegistry (block defs + per-face tiles), Chunk (16×128×16 Uint8Array),
               ChunkManager (world block access), ChunkStreamer (load/unload + worker pool + edit delta)
  terrain/     TerrainGenerator (seeded octave simplex heightmap), terrainWorker (off-thread gen)
  rendering/   ChunkMesher (exposed-face geometry), ChunkRenderer (scene meshes, re-mesh budget),
               TextureAtlas (procedural canvas atlas), DayNightCycle (sun/sky/fog)
  player/      Player (movement + AABB physics), Raycast (DDA voxel traversal),
               BlockInteraction (break/place + highlight)
  ui/          Hotbar, DebugOverlay (F3), Menu (pause/settings)
  save/        SaveManager (localStorage autosave, export/import, new world/reset)
  main.ts      Composition root: builds the world, wires systems into the game loop
```

Key flow: the **fixed-timestep update** (60 Hz) runs player physics and interaction; the **render callback** streams chunks around the player, re-meshes dirty chunks (budgeted per frame), and draws. Block edits go through `ChunkStreamer.setBlock`, which records the delta for saving and flags the owning chunk (plus border neighbors) dirty for re-meshing.
