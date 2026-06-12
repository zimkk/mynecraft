# VoxelCraft — Build Progress

## Stabilization pass (before Phase 11) ✅
Bugs found and fixed:
1. **AABB collision clamped to the first overlapping cell, not the most restrictive** (`Player.moveAxis`) — with several overlapped cells the player could clamp to the wrong plane and clip beside steps. Now scans all cells and takes the min/max candidate per travel direction.
2. **Leaves rendered in the transparent pass** (depth-write off, double-sided) — caused see-through canopies and sort artifacts against water/glass. Switched to opaque "fast" leaves (full alpha, occluding), which also culls more faces.
3. **Fresh worlds could spawn underwater** — spawn used `heightAt(0,0)` unconditionally. Added a spiral search for the nearest dry column above sea level.

Audited and confirmed OK: cross-chunk-border face culling (world-coord neighbor lookups + neighbor dirty-marking on border edits), re-mesh after edits (chunk + border neighbors flagged), DDA raycast face normals, placement-inside-player rejection.

All phases complete. `npm run dev` → http://localhost:5173. Zero TypeScript errors (`npm run typecheck`), zero console errors.

## Phase 1 — Scaffold & Render Loop ✅
- Vite + TS + Three.js; `Game` class with fixed-timestep (60 Hz) update + rAF render; FPS counter.
- **Verify:** lit spinning cube, FPS top-left. *(Superseded by later phases.)*

## Phase 2 — Voxel World & Chunks ✅
- Block registry (11 types, per-face tiles); 16×128×16 chunks in flat `Uint8Array`; ChunkManager keyed by chunk coords; mesher emits only exposed faces incl. across chunk borders, one BufferGeometry per chunk per pass.
- **Verify:** flat 4×4 chunk world rendered at ~20k triangles (interior faces culled), 180 FPS.

## Phase 3 — Texture Atlas & Block Faces ✅
- Runtime canvas atlas of procedural 16×16 tiles, nearest-neighbor filtering, per-face UVs (grass top/side/bottom, log bark/rings, glass, water alpha).
- **Verify:** crisp per-face textures on all block types.

## Phase 4 — Procedural Terrain ✅
- 4-octave seeded simplex heightmap (stone/dirt/grass, sand near water level, water fill to y=32); chunks stream in around the player nearest-first and unload beyond renderDistance+1; string seed reproduces the world.
- **Verify:** walk/fly around — new terrain streams in, old chunks free (F3 shows loaded count).

## Phase 5 — Player Controller & Physics ✅
- Pointer Lock mouse look; WASD relative to yaw; gravity + jump; axis-separated AABB collision (slides along walls, lands on blocks); fly toggle (double-Space or F) with sprint.
- **Verify:** walk, bump, jump, fall; no clipping; fly mode works.

## Phase 6 — Block Breaking & Placing ✅
- DDA voxel raycast (not mesh raycasting), wireframe highlight on target; LMB break / RMB place with hold-repeat; placement blocked inside player AABB; edits re-mesh the chunk + border neighbors.
- **Verify:** mine/build; meshes update instantly; can't place on yourself.

## Phase 7 — Inventory / Hotbar & UI ✅
- 9-slot hotbar (keys 1–9 + wheel) with atlas-derived icons; crosshair; F3 debug overlay (XYZ, chunk, facing, FPS, chunks, triangles, target, mode, time).
- **Verify:** selection drives placement; overlay updates live.

## Phase 8 — Lighting & Day/Night ✅
- 5-minute day cycle: sun orbits, sky/fog blend day↔dusk↔night, ambient dims at night; linear fog tracks render distance to hide pop-in. Per-face directional shading baked into vertex colors (cheap AO-ish contrast).
- **Verify:** wait (or watch F3 clock) — sky transitions; horizon fades into fog.

## Phase 9 — Save / Load ✅
- Save = seed + edit-delta + player state + time → localStorage; autosave every 15 s, on tab hide, on unload, on pause; export/import JSON; new world (seed input) and reset via menu (staged + page reload).
- **Verify:** build something, reload — world/position/hotbar persist. Export → Reset → Import round-trips.

## Phase 10 — Performance & Polish ✅
- Terrain generation moved to a Web Worker pool (transferable buffers) — no generation hitches; spawn area pre-generated synchronously once.
- Frustum culling: chunk meshes are culled per-mesh by Three.js against the camera frustum (chunk-sized geometries make this effective).
- Pause/main menu: resume, live render-distance slider (3–12, persisted), seed input/new world, export/import, reset, controls list. Game logic pauses while menu open.
- **Verify:** teleport/fly far — FPS stays at cap while chunks stream; slider changes view distance live.

---

# Phase 2 roadmap

## Phase 11 — Item & Entity System ✅
- Item registry (string ids; block/tool/material/food/misc types, max stack, atlas icon, tool/food metadata slots for later phases); `ItemStack {id,count,durability?}`.
- `Inventory` (36 slots, hotbar = 0-8): add with auto-stacking (existing stacks first), remove/swap/split helpers, onChange events for UI.
- Blocks define `drops` (grass→dirt, stone→cobblestone, leaves→nothing); breaking spawns a spinning/bobbing dropped-item entity with gravity + ground collision, 120 s despawn, pickup radius 1.5 with auto-stack merge.
- Hotbar refactored to render live inventory slots (icons, counts, durability bar support); placing consumes one item; empty hand places nothing.
- Save format bumped to **v2** (adds inventory) with v1→v2 migration.
- **Verify:** break a block → item pops out → walk over it → stacks in hotbar. Verified via scripted QA (`window.vox`): grass dropped dirt, 3 drops merged into one stack, hotbar UI updated.

## Phase 12 — Full Inventory & Hotbar UI ✅
- Inventory screen on `E`: 27 main slots + hotbar row. Minecraft-style cursor stack: left-click pick/place/swap/merge, right-click split-half / place-one, shift-click quick-move between hotbar and main.
- Click the backdrop (outside the panel) to toss the cursor stack into the world; `Q` tosses one of the selected item while playing; closing the screen returns the cursor stack to the inventory.
- Creative palette tab (visible in creative mode — interim toggle in pause menu, full mode rules in Phase 17): grab max stacks (LMB), singles (RMB), or shift-click straight into the inventory; items are infinite.
- Pointer lock released while open; pause menu suppressed via `invScreen.open`; game logic frozen.
- **Verify (scripted + visual):** picked up 64 stone, right-click-placed 2, merged back; shift-click moved stacks between sections; palette granted a 64-stack; counts and icons render; inventory persists in the v2 save.

## Phase 13 — Trees, Ores & Caves ✅
- **Trees:** deterministic one-anchor-per-8×8-cell placement (seeded hash, ~40% cell density), trunks 4-6 logs with layered canopies. Cross-chunk safety: each chunk evaluates all anchors within a 3-block margin and writes only its own blocks — no cut trunks or floating canopies at seams, no deferred-block queue needed.
- **Ores:** seeded random-walk veins replacing stone — coal (y5-58, common), iron (y5-40), gold (y5-22), diamond (y5-14, rare). New ore blocks drop coal/diamond items directly; iron/gold drop ore blocks for smelting (Phase 16).
- **Caves:** 3D simplex carve (threshold 0.68) through the stone layer with a 4-block surface roof; never under water columns so oceans don't drain.
- Atlas expanded 4×4 → 8×8; ore tiles + item icons (coal, diamond, stick, ingots) added; materials registered.
- **Verify:** forests visible with whole trees across chunk borders; sampled 40k underground cells: coal 163 / iron 158 / gold 90 / diamond 42, ~4% cave air. Leaves drop nothing; logs drop logs.
- Deferred: leaf decay (optional per spec).

## Phase 14 — Crafting System ✅
- Recipe registry: shaped (bounding-box-trimmed pattern match, works at any offset in the grid) + shapeless (multiset match). Output preview in the result slot; taking it consumes one of each occupied cell; shift-click crafts repeatedly.
- 2×2 grid in the inventory screen; crafting table block (right-click) opens the same screen in 3×3 mode. Grid contents return to the inventory on close.
- Recipes: log→4 planks, planks→sticks, crafting table, furnace (8 cobble), torches (coal+stick), and all 5 tool classes × 5 tiers (wood/stone/iron/gold/diamond).
- New blocks: crafting table, furnace (UI in Phase 16), torch with a custom mini-box model — targetable but walk-through via the new `collidable` flag (physics now uses `isCollidable`).
- 25 procedural tool icons (class shapes × tier colors) in the atlas; tool items registered with tier stats (speed/harvest level/durability/damage) for Phase 15.
- **Verify (scripted):** log→planks→sticks→wooden pickaxe all match; offset 2×2 in 3×3 works; invalid pattern → no output; crafting consumed exactly one log. Torch/table/furnace render in-world.
- Deferred: chest (needs a container framework; can ride along with a later phase).

## Phase 15 — Tools, Materials & Mining Rules ✅
- Blocks define hardness, preferred tool class, `requiresTool`, and min harvest level (iron needs ≥ stone pick, gold/diamond ≥ iron pick).
- Break time = hardness × 1.5 / toolSpeed with the right tool (and sufficient tier), hardness × 5 otherwise; insufficient harvest level also drops nothing. Swords shred leaves; axes speed wood; shovels speed dirt/sand.
- 4-stage crack overlay (procedural atlas tiles) on the targeted block while mining; progress resets when the target changes.
- Tools lose 1 durability per block and are removed at 0 (durability bar shows in slots). Creative: instant break, no durability, no consumption.
- **Verify (scripted):** stone barehand 7.5 s/no drop; wooden pick 1.13 s/drop/-1 durability; iron ore + wooden pick 7.5 s/NO drop; + stone pick 1.13 s/drop; tool at 1 durability broke and was removed.

## Decisions & known issues
- Phases were verified in-browser (screenshots + scripted checks via the `window.vox` dev hook).
- Water is rendered as a transparent pass without surface animation; swimming physics not implemented (water is non-solid — you sink/walk through it).
- Block light propagation (flood-fill) skipped per spec's "only if perf allows" — directional face shading covers the look; caves aren't generated yet anyway.
- `New World` / `Reset` / `Import` reload the page to rebuild the world cleanly rather than tearing down the scene in place.
- Esc-then-resume has a ~1 s browser-enforced Pointer Lock cooldown; clicking Play again after that works.
