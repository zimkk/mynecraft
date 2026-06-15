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

## Phase 16 — Furnace & Smelting ✅
- Furnace block entities keyed by world position (`FurnaceManager`), ticked on **wall-clock time** from the render loop — smelting continues while the UI is open, while paused, and while you walk away.
- Recipes: iron ore→ingot, gold ore→ingot, sand→glass, cobblestone→stone, log→coal (charcoal). 5 s per item; progress decays without fuel/input.
- Fuel values: coal = 8 smelts, log/planks = 1.5, sticks = 0.5. Output stacks; input/fuel consumed correctly.
- Furnace UI (right-click): input over fuel with a flame burn-down indicator, smelt progress bar, take-only output slot; shift-click works for all furnace slots.
- Breaking a furnace spills its contents as item drops. Save bumped to **v3** (furnace states) with v2→v3 migration.
- **Verify (scripted):** 3 iron ore + 1 coal → 3 iron ingots in 15.2 s with no UI open; fuel decremented 15 s of 40; input emptied.

## Phase 17 — Survival Mechanics & Game Modes ✅
- Health (20) with fall damage (past 3.5-block grace), drowning (10 s air, then 2 dmg/s), void damage; red vignette flash on hit.
- Hunger (20) + saturation buffer: passive drain, sprint/jump exhaustion; ≥18 hunger regenerates health (costing exhaustion); 0 hunger starves down to half a heart.
- Eating: hold RMB with food (1.2 s); apple registered (leaves have an 8% bonus apple drop).
- Death: inventory spills as drops where you fell, death screen, respawn at world spawn with full stats.
- Game modes persisted in the save (**v4**: health/hunger/gameMode): creative = fly/invulnerable/instant-break/infinite + hidden survival HUD + palette; survival = no flight.
- HUD: hearts, drumsticks, air bubbles (shown only underwater) above the hotbar.
- **Verify (scripted + visual):** damage 5 → 15 HP; eat capped at 20; lethal damage → death screen, inventory spilled; respawn restored 20/20 at spawn; HUD renders all three rows.
- Known simplification: water has no swim physics yet (normal gravity underwater).

## Phase 18 — Mobs ✅
- Entity framework: boxy multi-part models (Three.js groups) with leg-swing animation and red hurt flash; voxel AABB physics (axis-separated, same approach as the player) with auto-jump when walking into a 1-block step.
- **Passive** pigs & sheep: idle/wander state machine, flee when hit, drop raw porkchops / wool. **Hostile** zombies: chase within 18 blocks (greedy steering + jumps), attack on contact (3 dmg, 1.1 s cooldown, knocks the player back), burn in daylight unless under a roof.
- Spawning: attempts every 2 s in a 20-44 block ring at surface height — zombies at night (cap 10), animals by day (cap 8); despawn beyond 80 blocks. Mobs are not saved; the world repopulates on load.
- Combat: LMB raycast-marches the look ray against mob AABBs (priority over mining); damage = held tool damage (swords highest); both sides take knockback; tools lose durability on hits.
- New: wool block + item, raw/cooked porkchop foods, raw→cooked smelting recipe; player knockback impulse support.
- **Verify (scripted):** zombie chased and damaged the player (killed the half-health QA player — death flow fired correctly); zombie burned to death in daylight; dead pig dropped loot; melee ray hit a pig for 4 (10→6), triggering flee + knockback −7 z; level ray correctly passes OVER a 0.9-block pig.
- Note: an apparent FPS drop during QA was confirmed to be browser rAF-throttling of the occluded preview window (120 mob updates = 0.3 ms CPU; 65 draw calls).

## Phase 19 — Lighting, Particles & Sound ✅
- **Light engine:** per-chunk skylight (poured down columns, −2 through water) + torch light (level 14), both BFS flood-filled through non-opaque cells with −1 attenuation. Faces are lit by the cell they face into. Recomputation is per-chunk and lazy (computed on demand when meshing), so edits stay O(one chunk) — light deliberately does not cross chunk borders (rarely visible; documented trade-off).
- **Chunk shader:** replaced Lambert with a custom ShaderMaterial — per-vertex (sky, torch) light attributes pre-multiplied by face shade; fragment combines `max(torch, sky × dayFactor)` with a 0.035 floor + linear fog. Night dims the world live via the uniform with zero re-meshing; torch-lit areas stay bright at night. Mobs/item drops keep Lambert + scene fog.
- **Particles:** 400-slot pooled THREE.Points; block-break bursts tinted by the block's average tile color; eating crumbs.
- **Sound:** procedural WebAudio (no assets) — filtered-noise thuds for break/place (pitch by material: stone/wood/dirt), oscillator blips for pickup/hurt/mob-hit, tool-break crack, eat crunch; world sounds attenuate with distance.
- **Verify (scripted + visual):** cave at y16 renders near-black; placing a torch lit it instantly (mesh update < 1 frame, edit cost 0.2 ms); probed light values: torch cell 14, adjacent air 13, two away 12, opaque cells 0; surface skylight 15; dusk surface render dims correctly with fog.

## Phase 20 — Balance, Polish & Persistence ✅
- Settings menu: render distance (live), mouse sensitivity (0.2-3×), volume — all persisted in localStorage with validation/clamping on load.
- New World now takes a game mode (survival/creative select) staged alongside the seed across the reload.
- Save format v4 covers seed, edit delta, player pos/look, inventory, health/hunger, game mode, time of day, furnace states; migrations v1→v4 chain; mobs respawn by design.
- Controls list updated in the pause menu and README; README rewritten with the full architecture overview and gameplay-loop doc.
- Final QA: typecheck clean, zero console errors/warnings, settings live-apply verified (sensitivity slider → player), 164-180 FPS at render distance 12 in the dev preview.
- Balance: progression wood→stone→iron→diamond enforced by harvest levels; coal 8-smelt fuel; zombie 3 dmg / 1.1 s; caps 10 hostile / 8 passive.

## WASD direction fix ✅
- **Movement was mirrored on X as you turned.** The yaw-rotation of the WASD input vector had both cross-terms negated (`vx = mx·cos − mz·sin`, `vz = mz·cos + mx·sin`). Correct rotation for camera forward `(−sin,−cos)` / right `(cos,−sin)` with W=`mz−1`, D=`mx+1` is `vx = mx·cos + mz·sin`, `vz = mz·cos − mx·sin`. It happened to be correct only near yaw≈0 (sin≈0), which is why it felt fine facing one way and drifted wrong after looking around.
- **Verify (scripted):** W·lookDir = 1.0, S·lookDir = −1.0, D·cameraRight = 1.0 at yaw 0/45/90/180/270 — exact at every angle.

## Controls & interaction fix pass ✅
1. **One-shot input double/stale firing:** `justPressed`/`buttonJustPressed` were cleared once per rendered frame, but the fixed-timestep loop can run twice per frame — a single Space press could read as a double-tap (random flight toggles in creative), Q dropped two items, melee swung twice. Now cleared at the end of each fixed tick; input buffered while paused is discarded (`clearTransient`), so nothing fires and the camera doesn't jerk on resume.
2. **Phantom fall damage via water:** fall distance kept accumulating while falling into water, then applied on the first solid landing when wading ashore. Water (and flight) now zero fall distance.
3. **No swimming:** deep water was inescapable. Added water physics — body submerged: hold Space to rise (cap 3.5), slow sink (cap −4), reduced gravity, 0.55× move speed.
4. **Unhandled pointer-lock failures:** re-locking during the browser's post-Esc cooldown threw unhandled rejections and could leave a paused-but-menuless state. All lock requests now go through `Input.requestLock()` with a fallback that opens the pause menu.
5. **Food blocked crafting tables/furnaces:** holding food swallowed right-click entirely; interactive block targets now take priority over eating.
6. **F3 misfiring:** the debug toggle polled `justPressed` from the render loop, where ticks may already have consumed it — moved to a dedicated keydown listener (also works while paused).

## Decisions & known issues
- Phases were verified in-browser (screenshots + scripted checks via the `window.vox` dev hook).
- Water is rendered as a transparent pass without surface animation; swimming physics not implemented (water is non-solid — you sink/walk through it).
- Block light propagation (flood-fill) skipped per spec's "only if perf allows" — directional face shading covers the look; caves aren't generated yet anyway.
- `New World` / `Reset` / `Import` reload the page to rebuild the world cleanly rather than tearing down the scene in place.
- Esc-then-resume has a ~1 s browser-enforced Pointer Lock cooldown; clicking Play again after that works.
