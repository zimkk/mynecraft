# Mynecraft — by Hassan Nazir

A Minecraft-style voxel game built from scratch in **TypeScript + Three.js + Vite**, running entirely in the browser. Procedural terrain with trees, ores and caves; survival gameplay with crafting, tools, smelting, hunger, mobs and combat; flood-fill lighting with torches and a day/night cycle; full save/load. Everything — chunk meshing, AABB physics, voxel raycasting, lighting, AI — is hand-written; the only runtime dependencies are `three` and `simplex-noise`.

## Run it

```bash
npm install
npm run dev      # → http://localhost:5173
```

`npm run build` type-checks and produces a production bundle in `dist/`. Click the canvas to capture the mouse and play. Progress autosaves to localStorage every 15 s and on tab close.

## Controls

| Input | Action |
| --- | --- |
| **WASD** | Move (relative to look direction) |
| **Mouse** | Look (Pointer Lock) |
| **Space** | Jump |
| **Ctrl / Shift** | Sprint |
| **Left click** | Break block (hold) / attack mob |
| **Right click** | Place block · use crafting table/furnace · hold to eat |
| **E** | Open/close inventory (with 2×2 crafting grid) |
| **Q** | Drop one of the selected item |
| **1–9 / scroll** | Select hotbar slot |
| **F3** | Debug overlay (position, chunk, FPS, target, time) |
| **Esc** | Pause menu (settings, new world, export/import) |
| **double-Space or F** | Toggle flight *(creative mode only; Space/C for up/down)* |

## Gameplay loop

Punch trees → craft planks, sticks and a crafting table → wooden tools → mine stone (needs a pickaxe to drop) → stone tools → mine iron ore (needs a stone pickaxe) → smelt it in a furnace with coal → iron tools → gold/diamond at deeper levels. Eat apples (from leaves) and porkchops (from pigs — cook them!) to keep hunger up; it gates health regeneration. Zombies spawn at night and burn at dawn; sheep drop wool, pigs drop porkchops. Torches light caves via real light propagation.

## Architecture

```
src/
  core/        Game loop (fixed-timestep update + rAF render), Input (Pointer Lock),
               Sound (procedural WebAudio — no audio assets)
  world/       Block registry (hardness/tools/drops), Chunk (16×128×16 Uint8Array),
               ChunkManager (world block access), ChunkStreamer (worker-based generation,
               load/unload ring), Furnace (block-entity smelting)
  terrain/     TerrainGenerator (octave simplex heightmap, caves, ore veins,
               cross-chunk-safe trees), terrainWorker (transferable block buffers)
  rendering/   ChunkMesher (face culling incl. chunk borders, per-face light sampling),
               ChunkMaterial (custom shader: baked light × dayFactor + fog),
               Lighting (per-chunk skylight + torch BFS), TextureAtlas (procedural
               16×16 tiles generated at runtime), ChunkRenderer, DayNightCycle, Particles
  player/      Player (AABB physics, survival stats), Raycast (DDA voxel traversal),
               BlockInteraction (timed mining, crack overlay, placement)
  entities/    ItemEntity + EntityManager (drops/pickup), Mob + MobManager
               (AI, spawning rules, combat)
  items/       ItemRegistry (blocks/tools/materials/food), Inventory (stacking slots)
  crafting/    Recipes (shaped + shapeless matching)
  ui/          Hotbar, InventoryScreen (cursor-stack + craft grids + furnace UI),
               StatsHud (hearts/hunger/air, death screen), DebugOverlay, Menu
  save/        SaveManager (versioned format v4 with migrations, autosave, export/import)
```

Key design decisions:

- **World = seed + edit delta.** Terrain regenerates deterministically from the seed; only player-modified blocks are saved, so saves stay tiny.
- **Meshing:** only exposed faces are emitted (neighbor lookups cross chunk borders through the ChunkManager); one opaque + one transparent geometry per chunk; Three.js per-mesh frustum culling applies.
- **Lighting:** skylight pours down columns and BFS-spreads with attenuation; torches BFS from level 14. Light bakes into vertex attributes; the fragment shader combines `max(torch, sky × dayFactor)` so day/night transitions need no re-meshing. Light is chunk-local by design (edits stay O(one chunk)).
- **Trees straddle chunk borders** via deterministic cell-hashed anchors: every chunk evaluates all anchors within a margin and writes only its own cells — no deferred-block queues.
- **Furnaces tick on wall-clock time** from the render loop, so smelting continues while menus are open or the player walks away.
- **Mobs are not persisted** — the world repopulates from spawn rules on load.
