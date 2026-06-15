# How the Original Minecraft Works — Comprehensive Reference

> A research reference compiled from the official **Minecraft Wiki** (minecraft.wiki) and related sources, documenting how the original game (primarily **Java Edition**) works: its systems, mechanics, tools, items, and exact numeric values. Intended as the ground-truth reference for the **Mynecraft** clone.
>
> Numbers reflect modern Java Edition (≈1.18–1.21) unless noted. Many values changed across versions (especially ore distribution, reworked in 1.18). Sources are listed at the end.

---

## 1. Overview & Editions

- **Minecraft** is a sandbox voxel game created by **Markus "Notch" Persson** and developed by **Mojang Studios** (acquired by Microsoft in 2014). First public release 2009 ("Classic"), full release **1.0 in November 2011**.
- The world is made of **1×1×1 metre blocks** ("voxels") on an integer grid. One block = one metre.
- **Editions:** *Java Edition* (PC, the original, written in Java + LWJGL/OpenGL) and *Bedrock Edition* (C++, cross-platform). This document targets **Java Edition** mechanics.
- The world is **procedurally generated** from a **seed** and is effectively **infinite** horizontally (±30 million blocks). Vertical range in modern versions: **Y = -64 to 320** (older versions 0–256).
- Terrain streams in/out as **chunks** of **16×16** blocks (full height), generated on demand around the player.

---

## 2. Game Modes

| Mode | Description |
|------|-------------|
| **Survival** | Gather resources, craft, manage health & hunger, fight mobs, take damage, finite resources. The "real" game. |
| **Creative** | Fly, invulnerable, infinite blocks/items from a palette, instant block breaking, no hunger. For building. |
| **Adventure** | Like Survival but blocks can only be broken/placed with the correct tools (for custom maps). |
| **Spectator** | Fly through blocks, no interaction, can see through other entities' eyes. |
| **Hardcore** | Survival locked to Hard difficulty; **death is permanent** (world deleted / locked to spectator). |

Difficulty levels: **Peaceful** (no hostile mobs, hunger doesn't damage, fast regen), **Easy**, **Normal**, **Hard** (more damage, starvation can kill).

---

## 3. The Player

### Stats & HUD
- **Health:** 20 HP = **10 hearts** (each heart = 2 HP, each half-heart = 1 HP).
- **Hunger:** 20 points = **10 drumsticks** (shown top-right of hotbar).
- **Armor:** 0–20 points (shown as chestplate icons) when wearing armor.
- **Experience (XP):** green bar above the hotbar + level number; gained from mining ores, smelting, killing mobs, breeding, etc.
- **Air/Breath:** 10 bubbles, shown only underwater.
- **Hotbar:** 9 selectable slots at the bottom centre.
- **Crosshair:** centre of screen.

### Body & camera
- **Hitbox (AABB):** **0.6 × 1.8 × 0.6** blocks (width × height × depth). Sneaking lowers height to **1.5**.
- **Eye height:** **1.62** blocks above the feet.
- **Auto-step:** the player automatically steps up obstacles **≤ 0.6 blocks** tall (slabs, paths) without jumping; full 1-block steps require a jump.

### Movement speeds (horizontal)
| Action | Speed |
|--------|-------|
| Walking | **≈ 4.317 m/s** (blocks/second) |
| Sprinting | **≈ 5.612 m/s** (+30% over walking) |
| Sprint-jumping (avg) | **≈ 7.127 m/s** |
| Sneaking | **≈ 1.3 m/s** (and you won't walk off edges) |

- **Sprinting** requires **hunger > 6**; it widens FOV slightly and consumes saturation/hunger faster. Sprint-jumping lets you clear **~4 blocks** horizontally (vs ~2 from a standing jump).

### Vertical physics (per-tick model, 20 ticks/second)
- **Jump initial velocity:** 0.42 blocks/tick → **jump height ≈ 1.2522 blocks** (clears a 1-block step with margin).
- **Gravity:** **0.08 blocks/tick²** downward, applied each tick.
- **Air drag:** velocity is multiplied by **0.98** each tick (vertical).
- **Terminal velocity:** ≈ **3.92 blocks/tick ≈ 78.4 m/s** for the player in free air.
- **Ground friction / "slipperiness":** default block slipperiness **0.6** (ice ~0.98). Horizontal movement *accelerates* toward a target speed and *decelerates* via friction — there is **momentum**, not instant start/stop.

> **Clone note (Mynecraft):** real Minecraft movement uses acceleration + friction (momentum), not instant velocity. Our clone now approximates this.

---

## 4. Health, Damage & Environmental Hazards

- **Max health:** 20 HP. After taking damage there is a **0.5 s (10-tick) invulnerability** window.
- **Fall damage:** `damage = floor(fallDistance) − 3` HP. **Falls of ≤ 3 blocks do no damage.** (e.g. 4-block fall = 1 HP, 10-block = 7 HP, 23-block = 20 HP = lethal.) Water, hay bales, slime blocks, etc. negate fall damage.
- **Drowning:** underwater, the **air bar** (10 bubbles) drains over ~**15 s**; once empty the player takes **2 HP every second** until they surface.
- **Fire / lava / magma:** continuous damage per tick while in contact (lava is ~4 HP per half-second and sets you on fire).
- **Suffocation** (inside a solid block), **cactus**, **void** (below the world), and **mob attacks** also deal damage.
- **Natural regeneration:** two systems —
  - *Fast regen:* when **hunger is full (20) and saturation > 0**, heals **1 HP every 0.5 s (10 ticks)**, costing **1.5 saturation per HP**.
  - *Normal regen:* when **hunger ≥ 18**, heals **1 HP every 4 s (80 ticks)**, costing **6.0 exhaustion per HP**.
- On **Peaceful** difficulty, health regenerates rapidly regardless of hunger.

---

## 5. Hunger System (detailed)

Three tracked variables (foodLevel shown; the other two hidden):

| Variable | Range | Role |
|----------|-------|------|
| **foodLevel** (hunger) | 0–20 | The visible hunger bar. |
| **foodSaturationLevel** | 0–foodLevel | Hidden buffer; consumed *before* hunger; enables fast regen. |
| **foodExhaustionLevel** | 0–4 | Accumulates from activity; when it hits 4 it resets and removes 1 saturation (or 1 hunger if saturation = 0). |

### Exhaustion cost per action
| Action | Exhaustion |
|--------|-----------|
| Walking / climbing | 0.0 (walking itself is free; only sprint/jump cost) |
| Sprinting | **0.1 per metre** |
| Swimming | **0.01 per metre** |
| Jumping | **0.05 per jump** |
| Sprint-jumping | **0.2 per jump** |
| Breaking a block | **0.005 per block** |
| Attacking an entity | **0.1 per hit** |
| Taking damage | **0.1 per instance** |
| Natural regeneration | **6.0 per HP healed** |
| Hunger status effect | 0.005 per tick per level |

### Thresholds
- **Hunger ≤ 6** → cannot sprint.
- **Hunger 0** → **starvation**: 1 HP every 4 s, down to a floor that depends on difficulty (Easy → 10 HP / 5 hearts; Normal → 1 HP / half heart; Hard → death).
- Eating restores hunger (and saturation, capped at the new hunger value).

### Food values (hunger restored / saturation)
| Food | Hunger | Saturation |
|------|--------|-----------|
| Apple | 4 | 2.4 |
| Bread | 5 | 6.0 |
| Carrot | 3 | 3.6 |
| Potato | 1 | 0.6 |
| Baked Potato | 5 | 6.0 |
| Melon Slice | 2 | 1.2 |
| Sweet Berries | 2 | 1.2 |
| Cookie | 2 | 0.4 |
| Raw Porkchop / Beef | 3 | 1.8 |
| **Cooked Porkchop / Steak** | **8** | **12.8** (best common food) |
| Raw Chicken | 2 | 1.2 |
| Cooked Chicken | 6 | 7.2 |
| Cooked Mutton | 6 | 9.6 |
| Golden Apple | 4 | 9.6 (+ regen & absorption effects) |

> **Saturation** = `hunger × modifier`; high-saturation foods (steak, golden apple) keep you fed far longer.

---

## 6. Blocks: Hardness & Tools

### Block hardness (base seconds to break = hardness × multiplier)
Hardness is a per-block property. Common values (Minecraft Wiki block data):

| Block | Hardness | Preferred tool |
|-------|----------|----------------|
| Leaves | 0.2 | Shears / Hoe / Sword |
| Glass, Glowstone | 0.3 | (any) |
| Sand, Gravel, Dirt, Clay | 0.5–0.6 | Shovel |
| Grass Block | 0.6 | Shovel |
| Sandstone | 0.8 | Pickaxe |
| Wool | 0.8 | Shears (fast) |
| Pumpkin / Melon | 1.0 | Axe |
| **Stone** | **1.5** | Pickaxe |
| **Cobblestone, Planks, Logs** | **2.0** | Pickaxe / Axe |
| Crafting Table, Chest | 2.5 | Axe |
| **Ores (coal/iron/gold/diamond/redstone/lapis/emerald)** | **3.0** | Pickaxe |
| Deepslate | 3.0 | Pickaxe |
| Deepslate ores | 4.5 | Pickaxe |
| Furnace | 3.5 | Pickaxe |
| **Obsidian** | **50** | Diamond+ Pickaxe |
| Bedrock, Barrier, Air | **−1 / unbreakable** | — |

### Tool classes and what they break fastest
- **Pickaxe** → stone, ores, metal/mineral blocks, bricks.
- **Axe** → wood, planks, logs, crafting tables, pumpkins.
- **Shovel** → dirt, grass, sand, gravel, clay, snow, soul sand.
- **Hoe** → leaves, hay, sponge, sculk, moss, target, dried kelp.
- **Sword** → cobwebs (fast), bamboo (instant), +50% faster on plants; deals the most melee damage.
- **Shears** → wool (fast), leaves & cobwebs (very fast, with drops), vines.

### Breaking-speed formula (Java Edition)
```
baseTime (s) = hardness × (canHarvest ? 1.5 : 5.0)

speedMultiplier:
  bare hand .......... 1
  wood tool .......... 2
  stone tool ......... 4
  copper tool ........ 5
  iron tool .......... 6
  diamond tool ....... 8
  netherite tool ..... 9
  gold tool ......... 12     (fastest, but tiny durability)
  shears on wool ..... 5
  shears on leaves ... 15
  sword on cobweb .... 15
  sword on bamboo .... 30

If using the correct tool, divide baseTime by speedMultiplier.
Efficiency enchant adds (level² + 1) to the tool speed.
Haste adds +(20 × level)% speed. Mining Fatigue multiplies by 0.3^level.
Underwater (no Aqua Affinity): ×5 slower. Off the ground (floating): ×5 slower.
A block breaks INSTANTLY if computed damage ≥ hardness × 30.
There is a 6-tick (0.3 s) cooldown between breaking successive blocks.
```
> **"Can harvest"** means you hold the right *tool class* **and** meet the block's minimum **mining level**. Using the wrong tool (or too low a tier on ore) still breaks the block (×5 slower) but **drops nothing** if a harvest level is required.

---

## 7. Tool & Armor Tiers

| Tier | Mining level | Durability | Speed ×mult | Attack dmg bonus | Enchantability | Repair material |
|------|:---:|:---:|:---:|:---:|:---:|---|
| **Wood** | 0 | **59** | 2 | +0 | 15 | Planks |
| **Gold** | 0 | **32** | 12 | +0 | 22 | Gold Ingot |
| **Stone** | 1 | **131** | 4 | +1 | 5 | Cobblestone / Deepslate |
| **Iron** | 2 | **250** | 6 | +2 | 14 | Iron Ingot |
| **Diamond** | 3 | **1561** | 8 | +3 | 10 | Diamond |
| **Netherite** | 4 | **2031** | 9 | +4 | 15 | Netherite Ingot (+smithing) |

(*Copper tools exist in newer versions: level ~1.5, durability 191, speed 5.*)

### Mining-level gating (which tier is required to get drops)
- **Level 0 (wood+):** stone, cobblestone, coal ore.
- **Level 1 (stone+):** iron ore, copper ore, lapis ore.
- **Level 2 (iron+):** gold ore, redstone ore, diamond ore, emerald ore.
- **Level 3 (diamond+):** obsidian, ancient debris, crying obsidian, netherite block.

> A **wooden pickaxe can mine stone** but **cannot harvest iron ore** (no drop) — you need at least a **stone** pickaxe. Diamond/gold/redstone/emerald ore need at least an **iron** pickaxe. This gating drives the core progression: **wood → stone → iron → diamond → netherite.**

### Durability mechanics
- Tools lose **1 durability per block broken** (or per hit for weapons; per use for shears/flint&steel). They **break** (vanish) at 0.
- **Unbreaking** enchant gives a chance to *not* consume durability. **Mending** repairs with XP.

---

## 8. Crafting

- **Inventory crafting grid:** **2×2** (in the player inventory).
- **Crafting Table:** **3×3** grid (place & right-click the block).
- Recipes are **shaped** (pattern/position matters, e.g. tools) or **shapeless** (any arrangement, e.g. planks).
- Crafting consumes **one of each input** per craft and yields the output stack.

### Essential early-game recipes
| Output | Recipe |
|--------|--------|
| 4 × Planks | 1 Log (shapeless) |
| 4 × Sticks | 2 Planks stacked vertically |
| Crafting Table | 2×2 Planks |
| Chest | 8 Planks (ring, hollow centre) |
| Furnace | 8 Cobblestone (ring, hollow centre) |
| 4 × Torches | Coal/Charcoal over a Stick (vertical) |
| **Pickaxe** | `XXX / .S. / .S.` (3 material + 2 sticks) |
| **Axe** | `XX / XS / .S` |
| **Shovel** | `X / S / S` |
| **Sword** | `X / X / S` |
| **Hoe** | `XX / .S / .S` |
| Bread | 3 Wheat in a row |
| Bowl | 3 Planks in a "V" |
| Bed | 3 Wool + 3 Planks |
| Iron/Gold/Diamond Block | 9 ingots/gems in 3×3 (and reversible) |

(`X` = tier material: planks → wood tools, cobblestone → stone, iron ingot → iron, gold ingot → gold, diamond → diamond. `S` = stick.)

---

## 9. Smelting (Furnace)

- A furnace has **3 slots:** input (top), **fuel** (bottom), output (right).
- **Smelt time:** **10 seconds (200 ticks)** per item.
- Smelting **grants XP** when output is collected (e.g. iron 0.7, gold 1.0, food ~0.35).

### Fuel burn times
| Fuel | Burn time | Items smelted |
|------|-----------|:---:|
| Stick | 5 s (100 ticks) | 0.5 |
| Plank / Log / Wood | 15 s (300 ticks) | 1.5 |
| **Coal / Charcoal** | **80 s (1600 ticks)** | **8** |
| Block of Coal | 800 s | 80 |
| Blaze Rod | 120 s | 12 |
| **Lava Bucket** | 1000 s | **100** (most efficient) |

### Common smelting recipes
| Input → Output | XP |
|----------------|----|
| Raw Iron / Iron Ore → Iron Ingot | 0.7 |
| Raw Gold / Gold Ore → Gold Ingot | 1.0 |
| Sand → Glass | 0.1 |
| Cobblestone → Stone | 0.1 |
| Raw Porkchop/Beef → Cooked | 0.35 |
| Raw Chicken → Cooked Chicken | 0.35 |
| Log/Wood → Charcoal | 0.15 |
| Clay (ball/block) → Brick | 0.3 |
| Cactus → Green Dye, Kelp → Dried Kelp, Wet Sponge → Sponge | — |

- The furnace **keeps smelting while its UI is closed** and while the chunk is loaded (it's a block-entity ticked by the world).

---

## 10. Inventory & Items

- **Player inventory:** **27** main storage slots + **9** hotbar + **4** armor slots (helmet/chest/legs/boots) + **1** off-hand = **41** slots.
- **Item stacks:** most items stack to **64**; tools/weapons/armor and a few items stack to **1**; some (ender pearls, snowballs, signs, buckets of...) to **16**.
- **Item types:** *block items* (placeable), *tools*, *weapons*, *armor*, *food*, *materials* (ingots, sticks, gems), *brewing/potions*, *misc*.
- **Dropped items** are entities: they fall with gravity, can be picked up by walking near them (auto-merge into the inventory), and **despawn after ~5 minutes**. On death, a player drops their whole inventory (configurable via `keepInventory`).
- **Hotbar selection:** number keys **1–9** or scroll wheel. **Q** drops one item; **Ctrl+Q** drops the stack.

---

## 11. World Generation

### Terrain
- Generated from a **seed** via layered noise; the same seed always reproduces the same world.
- Surface layering: **grass/dirt on top**, dirt subsurface, **stone** below, **deepslate** below Y=0, **bedrock** at the bottom.
- **Sea level ≈ Y = 63**; oceans, rivers, and lakes fill to sea level; **beaches/sand** near water.
- **Biomes** are chosen from temperature/humidity/continentalness noise: plains, forest, desert, taiga, jungle, savanna, swamp, snowy, mountains, badlands, ocean variants, etc. Each affects blocks, foliage, color, and mob types.

### Caves & structures
- **Caves** and ravines are carved with 3D noise (incl. large "cheese/spaghetti/noodle" caves in 1.18+).
- **Trees** generate as structures (trunk of logs + leaf canopy) at biome-dependent density; they correctly straddle chunk borders.
- Other structures: villages, mineshafts, strongholds, dungeons, temples, ruins, ocean monuments, etc.

### Ore distribution (Java 1.18+)
| Ore | Y-range | Most common at Y | Min tool to harvest |
|-----|---------|:---:|---|
| **Coal** | 0 → 320 (and high mountains) | ~45 (and ~136) | Wood pickaxe |
| **Copper** | -16 → 112 | ~43 | Stone pickaxe |
| **Iron** | -64 → 72 (peaks again high in mountains) | ~16 and ~232 | Stone pickaxe |
| **Lapis Lazuli** | -64 → 64 | ~0 | Stone pickaxe |
| **Redstone** | -64 → 15 | the deeper the better | Iron pickaxe |
| **Gold** | -64 → 32 | ~-16 | Iron pickaxe |
| **Diamond** | -64 → 16 | **~-59** (deepest = most) | Iron pickaxe |
| **Emerald** | -16 → 320 (mountain biomes) | high mountains | Iron pickaxe |

- Veins are small clusters (typically **4–9 blocks**); deeper ores (diamond, redstone) become more common toward the world bottom. Redstone ore drops **4–5 dust**; lapis drops **4–9**.

---

## 12. Lighting

- **Light level:** integer **0–15** per block. The game uses `max(skyLight, blockLight)` for brightness.
- **Sky light:** value **15** under open sky; spreads **down through transparent blocks at full strength**, and **−1 per block** horizontally/upward. (Sky light value doesn't drop at night — instead an *internal* darkening drives mob spawns.)
- **Block light:** emitted by light sources, **−1 per block of taxicab distance** (diamond-shaped falloff).
- **Light-filtering blocks** reduce light: **water, leaves, ice, cobweb** reduce by 1 per block.

### Light source levels
| Source | Level |
|--------|:---:|
| Glowstone, Sea Lantern, Lava, Jack o'Lantern, Beacon | **15** |
| **Torch**, End Rod, Soul Lantern→? | **14** |
| Lit Furnace, Redstone Lamp (on) | 13 |
| Lit Campfire | 15 |
| Glow Lichen, Magma Block | 3 |

### Light & gameplay
- **Hostile mobs** spawn where **block light = 0** and **internal sky light ≤ 7** (effectively: dark areas, or anywhere at night on the surface).
- **Passive mobs** (Java) need **block light ≥ 9** if not under open sky; historically they needed light ≥ 7+ on grass.
- **Crops** need light **≥ 9** to grow.

> **Clone note:** real Minecraft propagates light via flood-fill (BFS) from the sky and from emitters, recomputed incrementally on block changes — exactly the model Mynecraft uses (skylight + torch light, baked into vertex lighting).

---

## 13. Day/Night Cycle

- One full cycle = **24,000 ticks = 20 real minutes** (20 ticks/second).

| Phase | Ticks | Duration | Clock |
|-------|-------|----------|-------|
| **Day** | 0 → 12000 | 10 min | 06:00 (sunrise) → 18:00 |
| Noon | 6000 | — | 12:00 (brightest) |
| **Dusk / Sunset** | 12000 → 13000 | 50 s | 18:00 → 19:00 |
| **Night** | 13000 → 23000 | 8 min 20 s | 19:00 → 05:00 |
| Midnight | 18000 | — | 00:00 (darkest) |
| **Dawn / Sunrise** | 23000 → 24000 | 50 s | 05:00 → 06:00 |

- Surface **hostile mobs spawn during darkness** (~tick 13188–22812 in clear weather); daylight **burns** undead (zombies/skeletons) unless sheltered, in water, or wearing helmets.
- The **moon** has **8 phases**, cycling over **8 days** (192,000 ticks).
- Sleeping in a **bed** at night skips to dawn and sets the spawn point.

---

## 14. Mobs (Entities)

### Categories
- **Passive:** pig, cow, sheep, chicken, rabbit, horse, etc. Never attack; flee when hit; drop food/materials. (Sheep → wool + mutton; pig → porkchop; cow → beef + leather; chicken → chicken + feathers.)
- **Neutral:** wolf, spider (hostile at night), enderman, bee, iron golem — attack only if provoked.
- **Hostile:** zombie, skeleton, creeper, spider, witch, slime, etc. Spawn in darkness/at night, seek and attack the player.
- **Boss:** Ender Dragon, Wither.

### Spawning rules (Java Edition)
- **Mob caps** (scaled by loaded chunks: `globalCap = mobCap × loadedChunks ÷ 289`):
  - **Monsters (hostile): 70**
  - **Creatures (passive animals): 10**
  - Ambient (bats): 15 · Water creatures: 5 · Water ambient (fish): 20 · Axolotl: 5
- **Spawn attempts:** hostile mobs are attempted **every tick**; passive animals roughly **every 400 ticks (20 s)** (most animals also spawn once during world/chunk generation).
- **Pack spawning:** a random point in a chunk is chosen and a small group spawns around it.
- **Distance rules (from nearest player):**
  - Mobs **never spawn within 24 blocks** (spherical) of a player.
  - Mobs **randomly despawn beyond 32 blocks**.
  - Mobs **despawn instantly beyond 128 blocks** (44 for some).
  - Spawn attempts occur within a **128-block sphere** (64 for fish).
- **Surface conditions:** a **solid block below**, enough **vertical space** (no collision above), and the **light/sky** rules from §12.

### Combat & AI
- **Melee:** attack has a **cooldown** (the attack-strength bar); full-charge hits deal full damage + knockback. Sword base damage by tier (wood 4 → netherite 8, +sweeping).
- **Knockback:** both player and mobs are pushed back on hit; sprinting/Knockback enchant increases it.
- **Mob AI:** state machines + **A\*-style pathfinding** over the voxel grid (navigate terrain, step up 1 block, avoid hazards/cliffs), recomputed on a timer for performance.
- **Creeper:** approaches and **explodes**; **skeleton:** ranged bow; **zombie:** chases, can break doors on Hard, burns in daylight; **spider:** climbs walls.

---

## 15. Experience, Enchanting & Brewing (summary)

- **XP** drops as small orbs from mining ores, smelting, killing mobs, breeding, fishing, trading. XP fills the bar; each **level** costs progressively more XP.
- **Enchanting Table** (+ bookshelves for higher levels) spends XP + **lapis lazuli** to add enchantments (Efficiency, Unbreaking, Fortune, Sharpness, Protection, Mending, etc.).
- **Anvil** combines/repairs items and applies enchanted books (costs XP).
- **Brewing Stand** + **blaze powder** fuel + **Nether wart** base makes **potions** (with various effects), modified by ingredients (e.g. glowstone = stronger, redstone = longer).

---

## 16. Default Controls (Java Edition)

| Key | Action |
|-----|--------|
| **W A S D** | Move (relative to look) |
| **Mouse** | Look |
| **Space** | Jump / swim up / fly up (creative) |
| **Left Shift** | Sneak / descend (creative) |
| **Left Ctrl** (or double-W) | Sprint |
| **Left Click** | Break block / attack |
| **Right Click** | Place block / use item / interact |
| **Mouse Wheel / 1–9** | Select hotbar slot |
| **E** | Open inventory |
| **Q** | Drop item (Ctrl+Q = drop stack) |
| **F5** | Toggle camera perspective |
| **F3** | Debug screen (coords, biome, FPS, light) |
| **Esc** | Pause / menu |
| Double-tap **Space** | Toggle fly (Creative) |

---

## 17. The Core Survival Loop (the "intended" first session)

1. **Punch a tree** → collect **logs** (no tools needed; ~3 s per log by hand).
2. Craft **logs → planks → sticks**, and a **crafting table**.
3. Craft a **wooden pickaxe** → mine **stone/cobblestone**.
4. Craft **stone tools** + a **furnace**.
5. Mine **coal** (torches), then **iron ore** (needs stone pickaxe) → **smelt** into iron ingots → **iron tools/armor**.
6. Survive the **first night** (hostiles spawn in the dark) — build/dig a shelter, place **torches** (light ≥ block-light blocks spawns).
7. Manage **hunger** (kill animals → cook meat) so health regenerates.
8. Descend to mine **diamonds** (Y ≈ −59, needs iron pickaxe) → **diamond gear** → enchanting, the Nether, and beyond.

Progression spine: **wood → stone → iron → diamond → netherite**, gated by tool **mining levels** and unlocked by **crafting + smelting**.

---

## Sources

- [Breaking — Minecraft Wiki](https://minecraft.wiki/w/Breaking)
- [Tiers — Minecraft Wiki](https://minecraft.wiki/w/Tiers)
- [Tool — Minecraft Wiki](https://minecraft.wiki/w/Tool)
- [Hunger — Minecraft Wiki](https://minecraft.wiki/w/Hunger)
- [Food / Food mechanics — Minecraft Wiki](https://minecraft.wiki/w/Food)
- [Ore — Minecraft Wiki](https://minecraft.wiki/w/Ore)
- [Mob spawning — Minecraft Wiki](https://minecraft.wiki/w/Mob_spawning)
- [Light — Minecraft Wiki](https://minecraft.wiki/w/Light)
- [Damage — Minecraft Wiki](https://minecraft.wiki/w/Damage)
- [Smelting — Minecraft Wiki](https://minecraft.wiki/w/Smelting)
- [Sprinting — Minecraft Wiki](https://minecraft.wiki/w/Sprinting)
- [Daylight cycle — Minecraft Wiki](https://minecraft.wiki/w/Daylight_cycle)

*Compiled June 2026 for the Mynecraft project. Minecraft is a trademark of Mojang Studios/Microsoft; this document is an independent reference compiled from the community Minecraft Wiki for a non-commercial clone.*
