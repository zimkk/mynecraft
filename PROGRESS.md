# VoxelCraft — Build Progress

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

## Decisions & known issues
- Phases were verified in-browser (screenshots + scripted checks via the `window.vox` dev hook).
- Water is rendered as a transparent pass without surface animation; swimming physics not implemented (water is non-solid — you sink/walk through it).
- Block light propagation (flood-fill) skipped per spec's "only if perf allows" — directional face shading covers the look; caves aren't generated yet anyway.
- `New World` / `Reset` / `Import` reload the page to rebuild the world cleanly rather than tearing down the scene in place.
- Esc-then-resume has a ~1 s browser-enforced Pointer Lock cooldown; clicking Play again after that works.
