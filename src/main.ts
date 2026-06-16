import * as THREE from 'three';
import { Game } from './core/Game';
import { Input } from './core/Input';
import { ChunkManager } from './world/ChunkManager';
import { Block } from './world/BlockRegistry';
import { ChunkStreamer } from './world/ChunkStreamer';
import { TerrainGenerator, WATER_LEVEL } from './terrain/TerrainGenerator';
import { NetherTerrainGenerator } from './terrain/NetherTerrainGenerator';
import { EndTerrainGenerator } from './terrain/EndTerrainGenerator';
import { findPortalInterior } from './world/Portal';
import { buildAtlasTexture } from './rendering/TextureAtlas';
import { ChunkRenderer } from './rendering/ChunkRenderer';
import { Player } from './player/Player';
import { BlockInteraction } from './player/BlockInteraction';
import { Hotbar } from './ui/Hotbar';
import { DebugOverlay } from './ui/DebugOverlay';
import { DayNightCycle } from './rendering/DayNightCycle';
import { Sky } from './rendering/Sky';
import { SaveManager, SaveData, SAVE_VERSION } from './save/SaveManager';
import { Inventory } from './items/Inventory';
import { EntityManager } from './entities/EntityManager';
import { InventoryScreen } from './ui/InventoryScreen';
import { FurnaceManager } from './world/Furnace';
import { ChestManager, ChestState } from './world/Chest';
import { RedstoneManager } from './world/Redstone';
import { BrewingManager } from './world/Brewing';
import { tryEnchant, sharpnessBonus, unbreakingSavesDurability } from './items/Enchanting';
import { StatsHud } from './ui/StatsHud';
import { MobManager } from './entities/MobManager';
import { TradeScreen } from './ui/TradeScreen';
import { Particles } from './rendering/Particles';
import { Sound } from './core/Sound';
import { blockDef } from './world/BlockRegistry';
import { tileAverageColor } from './rendering/TextureAtlas';
import { lightAt } from './rendering/Lighting';
import { itemDef, makeStack } from './items/ItemRegistry';
import { Menu, loadSettings } from './ui/Menu';

const app = document.getElementById('app')!;
const game = new Game(app);
const input = new Input(game.renderer.domElement);

// Lights + day/night cycle
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
game.scene.add(sun);
game.scene.add(sun.target);
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
game.scene.add(ambient);
const dayNight = new DayNightCycle(game.scene, sun, ambient);
const sky = new Sky(game.scene);
// (chunk shader uniforms attached after the renderer is created below)

// World: resume the saved world, start a staged new one, or roll a random seed.
const newSeed = SaveManager.consumeNewSeed();
const save = newSeed === null ? SaveManager.load() : null;
const SEED = newSeed ?? save?.seed ?? Math.random().toString(36).slice(2, 10);

const world = new ChunkManager();
const generator = new TerrainGenerator(SEED);
const netherGenerator = new NetherTerrainGenerator(SEED);
const endGenerator = new EndTerrainGenerator(SEED);
// Active dimension; the Nether/End share the same ChunkManager/ChunkRenderer
// instances (cleared and regenerated on switch — see ChunkStreamer.switchDimension).
let dimension: 'overworld' | 'nether' | 'end' = 'overworld';
// Exactly one remembered portal pair per direction (deliberate simplification
// vs. vanilla's multi-portal-link system, with no 1:8 coordinate scaling).
let netherSpawn: THREE.Vector3 | null = null;
let overworldNetherSpawn: THREE.Vector3 | null = null;
let endSpawn: THREE.Vector3 | null = null;
let overworldEndSpawn: THREE.Vector3 | null = null;
let dragonSpawnedThisVisit = false;
const atlas = buildAtlasTexture();
const chunkRenderer = new ChunkRenderer(game.scene, world, atlas);
dayNight.chunkUniforms = chunkRenderer.uniforms;
const settings = loadSettings();
const streamer = new ChunkStreamer(world, generator, chunkRenderer, settings.renderDistance);
if (save) {
  for (const [key, id] of save.edits) streamer.edits.set(key, id);
}

// Spawn at the nearest dry column to the origin (spiral search) so a fresh
// world never starts underwater.
function findDrySpawn(): { x: number; z: number } {
  for (let ring = 0; ring < 24; ring++) {
    for (let i = 0; i < Math.max(1, ring * 8); i++) {
      const angle = (i / Math.max(1, ring * 8)) * Math.PI * 2;
      const x = Math.round(Math.cos(angle) * ring * 8);
      const z = Math.round(Math.sin(angle) * ring * 8);
      if (generator.heightAt(x, z) > WATER_LEVEL + 1) return { x, z };
    }
  }
  return { x: 0, z: 0 };
}

// Pre-generate the spawn area synchronously so the player doesn't fall into
// void; everything afterwards streams in from the worker pool.
const drySpawn = save ? null : findDrySpawn();
const spawnX = save?.player.x ?? drySpawn!.x + 0.5;
const spawnZ = save?.player.z ?? drySpawn!.z + 0.5;
streamer.pregenerate(spawnX, spawnZ);

// Player spawns on top of the terrain (or where the save left them).
const player = new Player(world);
if (save) {
  player.position.set(save.player.x, save.player.y, save.player.z);
  player.yaw = save.player.yaw;
  player.pitch = save.player.pitch;
  player.flying = save.player.flying;
} else {
  player.position.set(
    Math.floor(spawnX) + 0.5,
    generator.heightAt(Math.floor(spawnX), Math.floor(spawnZ)) + 1,
    Math.floor(spawnZ) + 0.5,
  );
}

// Items, entities, interaction + UI
const inventory = new Inventory();
if (save?.inventory?.length) inventory.loadFrom(save.inventory);
const entities = new EntityManager(game.scene, world, atlas);
const hotbar = new Hotbar(document.body, atlas, inventory);
const interaction = new BlockInteraction(game.scene, world, streamer, player, entities, inventory, hotbar, atlas);
interaction.isCreative = () => creativeMode;
const debug = new DebugOverlay(document.body);
if (save) {
  hotbar.select(save.player.hotbarSlot);
  dayNight.time = save.time;
}

// Persistence: seed + edit delta + player state, autosaved to localStorage.
const saveManager = new SaveManager((): SaveData => ({
  version: SAVE_VERSION,
  seed: SEED,
  edits: [...streamer.edits.entries()],
  player: {
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    yaw: player.yaw,
    pitch: player.pitch,
    flying: player.flying,
    hotbarSlot: hotbar.selected,
  },
  time: dayNight.time,
  inventory: inventory.toJSON(),
  furnaces: furnaces.toJSON(),
  health: player.health,
  hunger: player.hunger,
  gameMode: creativeMode ? 'creative' : 'survival',
  chests: chests.toJSON(),
  redstone: redstone.toJSON(),
  xpLevel: player.level,
  xpPoints: player.xp,
  brewing: brewing.toJSON(),
}));

// Game mode: persisted in the save (a staged "New World" carries its own
// mode); creative = fly, invulnerable, instant break, infinite blocks.
let creativeMode = newSeed !== null
  ? SaveManager.consumeNewMode() === 'creative'
  : save?.gameMode === 'creative';
player.creative = creativeMode;
player.sensitivity = settings.sensitivity;
if (save) {
  player.health = save.health ?? 20;
  player.hunger = save.hunger ?? 20;
  player.level = save.xpLevel ?? 0;
  player.xp = save.xpPoints ?? 0;
}

// World spawn for respawns (where a fresh player would appear).
const worldSpawn = new THREE.Vector3(
  Math.floor(spawnX) + 0.5,
  generator.heightAt(Math.floor(spawnX), Math.floor(spawnZ)) + 1,
  Math.floor(spawnZ) + 0.5,
);

// Survival HUD + death flow: dying spills the inventory where you fell.
// Death always respawns at the Overworld world spawn (vanilla behavior) —
// dying in the Nether/End must also switch the shared chunk pipeline back,
// otherwise the player would stand at overworld coordinates while the
// renderer/world is still showing the dimension they died in.
const statsHud = new StatsHud(document.body, () => {
  statsHud.showDeath(false);
  if (dimension !== 'overworld') {
    dimension = 'overworld';
    streamer.switchDimension('overworld', generator);
    streamer.pregenerate(worldSpawn.x, worldSpawn.z);
  }
  player.respawn(worldSpawn);
  input.requestLock(() => { menu.visible = true; });
});
player.onDamage = () => statsHud.flash();
player.onDeath = () => {
  for (let i = 0; i < inventory.slots.length; i++) {
    const stack = inventory.get(i);
    if (stack) {
      const e = entities.dropItem(stack, player.eyePosition);
      e.velocity.set((Math.random() - 0.5) * 5, 3, (Math.random() - 0.5) * 5);
      e.pickupDelay = 2;
      inventory.set(i, null);
    }
  }
  input.unlock();
  statsHud.showDeath(true);
};

// Inventory screen (E). While open the pointer is unlocked but the pause
// menu must NOT appear — the pointerlockchange handler checks invScreen.open.
const invScreen = new InventoryScreen(document.body, atlas, inventory, {
  tossItem: (stack) => {
    const dir = player.lookDirection;
    const entity = entities.dropItem(stack, player.eyePosition.addScaledVector(dir, 0.4));
    entity.velocity.set(dir.x * 6, dir.y * 6 + 2, dir.z * 6);
    entity.pickupDelay = 1.5;
  },
  isCreative: () => creativeMode,
  requestClose: () => {
    invScreen.closeScreen();
    // If the browser refuses (Esc cooldown), fall back to the pause menu
    // instead of a stuck "nothing is open but the game is paused" state.
    input.requestLock(() => { menu.visible = true; });
  },
});

// Mobs: spawned around the player (zombies at night, animals by day,
// villagers near generated village structures).
const mobs = new MobManager(game.scene, world, entities, generator);
const mobCtx = {
  playerPos: player.position,
  isDay: true,
  attackPlayer: (mob: import('./entities/Mob').Mob) => {
    player.damage(mob.def.attackDamage ?? 2);
    player.knockback(player.position.x - mob.position.x, player.position.z - mob.position.z);
  },
  dimension: dimension as 'overworld' | 'nether' | 'end',
};

// Villager trading: right-click a villager to open it (wired below, near
// the other interactive-block UIs).
const tradeScreen = new TradeScreen(document.body, atlas, inventory, entities, () => {
  tradeScreen.close();
  input.requestLock(() => { menu.visible = true; });
});

// Furnace block entities (smelting continues on wall time, even paused).
const furnaces = new FurnaceManager();
if (save?.furnaces?.length) furnaces.loadFrom(save.furnaces);

// Chest block entities: 27-slot storage keyed by world position.
const chests = new ChestManager();
if (save?.chests?.length) chests.loadFrom(save.chests);

// Redstone: wire/torch/lever/button/lamp network, recomputed on change.
const redstone = new RedstoneManager();
if (save?.redstone?.length) redstone.loadFrom(save.redstone);

// Brewing stands: reagent + 3 bottle slots, ticks on wall time like furnaces.
const brewing = new BrewingManager();
if (save?.brewing?.length) brewing.loadFrom(save.brewing);

// Portals (Nether and End): carve a guaranteed-safe platform + frame at the
// destination so first arrival never lands in solid rock/void. `style`
// chooses the block flavor (Obsidian/NetherPortal vs. EndPortalFrame/
// EndPortal) — both portal pairs render identically on either end. Returns
// the safe position to stand, just in front of the portal interior.
function buildPortalPlatform(
  style: 'nether' | 'end',
  floorDim: 'overworld' | 'nether' | 'end',
  wx: number,
  wz: number,
): THREE.Vector3 {
  const floorY = floorDim === 'nether' ? 40 : floorDim === 'end' ? 60 : Math.max(5, generator.heightAt(wx, wz));
  const floorBlock = style === 'end' ? Block.EndStone : Block.Obsidian;
  const borderBlock = style === 'end' ? Block.EndPortalFrame : Block.Obsidian;
  const portalBlock = style === 'end' ? Block.EndPortal : Block.NetherPortal;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const x = wx + dx, z = wz + dz;
      streamer.setBlock(x, floorY, z, floorBlock);
      for (let y = floorY + 1; y <= floorY + 6; y++) streamer.setBlock(x, y, z, Block.Air);
    }
  }
  // Frame stands on a constant-Z plane, spanning X — 4 wide × 5 tall, 2×3 interior.
  for (let w = 0; w < 4; w++) {
    for (let h = 0; h < 5; h++) {
      const x = wx - 1 + w;
      const y = floorY + 1 + h;
      const border = w === 0 || w === 3 || h === 0 || h === 4;
      streamer.setBlock(x, y, wz, border ? borderBlock : portalBlock);
    }
  }
  return new THREE.Vector3(wx + 0.5, floorY + 1, wz + 2.5);
}

let portalTimer = 0;
let lavaTimer = 0;

/** Switch dimensions: tear down/regenerate the shared chunk pipeline and
 *  reposition the player at the remembered (or freshly built) portal.
 *  Two independent portal pairs are tracked: Nether↔Overworld and
 *  End↔Overworld, each remembering exactly one location per side. */
function teleport(target: 'overworld' | 'nether' | 'end'): void {
  if (target === dimension) return;
  const leavingPos = player.position.clone();
  const fromDim = dimension;

  if (fromDim === 'overworld') {
    if (target === 'nether') overworldNetherSpawn = overworldNetherSpawn ?? leavingPos;
    else overworldEndSpawn = overworldEndSpawn ?? leavingPos;
  } else if (fromDim === 'nether') {
    netherSpawn = netherSpawn ?? leavingPos;
  } else {
    endSpawn = endSpawn ?? leavingPos;
  }

  const remembered = target === 'nether' ? netherSpawn
    : target === 'end' ? endSpawn
    : (fromDim === 'nether' ? overworldNetherSpawn : overworldEndSpawn);
  const destX = remembered ? remembered.x : leavingPos.x;
  const destZ = remembered ? remembered.z : leavingPos.z;

  dimension = target;
  const gen = target === 'nether' ? netherGenerator : target === 'end' ? endGenerator : generator;
  streamer.switchDimension(target, gen);
  streamer.pregenerate(destX, destZ);

  let arrival: THREE.Vector3;
  if (remembered) {
    arrival = remembered.clone();
  } else {
    const style: 'nether' | 'end' = target === 'end' || fromDim === 'end' ? 'end' : 'nether';
    arrival = buildPortalPlatform(style, target, Math.floor(destX), Math.floor(destZ));
    if (target === 'nether') netherSpawn = arrival.clone();
    else if (target === 'end') endSpawn = arrival.clone();
    else if (fromDim === 'nether') overworldNetherSpawn = arrival.clone();
    else overworldEndSpawn = arrival.clone();
  }
  player.position.copy(arrival);
  player.velocity.set(0, 0, 0);
  portalTimer = 0;
  if (target === 'end') dragonSpawnedThisVisit = false;
  // Queued water-flow checks reference world coordinates that now mean
  // something else (different dimension, same ChunkManager) — drop them.
  pendingWaterFlow.length = 0;
  queuedWaterFlowKeys.clear();
}

// Ruin loot: rolled once, the first time a generated ruin's chest is opened.
const RUIN_LOOT_POOL = ['iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'coal', 'lapis', 'stick', 'apple'];
function rollRuinLoot(state: ChestState): void {
  const count = 3 + Math.floor(Math.random() * 3); // 3-5 stacks
  for (let i = 0; i < count; i++) {
    const id = RUIN_LOOT_POOL[Math.floor(Math.random() * RUIN_LOOT_POOL.length)];
    const amount = 1 + Math.floor(Math.random() * 4);
    const slot = Math.floor(Math.random() * state.length);
    if (!state[slot]) state[slot] = makeStack(id, amount);
  }
}

// Right-clicking interactive blocks opens their UI instead of placing.
interaction.onUseBlock = (id, x, y, z) => {
  if (id === Block.Obsidian && hotbar.selectedStack?.id === 'flint_and_steel') {
    const interior = findPortalInterior(world, x, y, z, Block.Obsidian);
    if (interior) {
      for (const [ix, iy, iz] of interior) streamer.setBlock(ix, iy, iz, Block.NetherPortal);
      sound.play('place');
      return true;
    }
  }
  if (id === Block.EndPortalFrame && hotbar.selectedStack?.id === 'ender_eye') {
    const interior = findPortalInterior(world, x, y, z, Block.EndPortalFrame);
    if (interior) {
      for (const [ix, iy, iz] of interior) streamer.setBlock(ix, iy, iz, Block.EndPortal);
      sound.play('place');
      return true;
    }
  }
  if (id === Block.CraftingTable) {
    invScreen.openScreen(3);
    input.unlock();
    return true;
  }
  if (id === Block.Furnace) {
    invScreen.openFurnace(furnaces.getOrCreate(x, y, z));
    input.unlock();
    return true;
  }
  if (id === Block.Chest) {
    const isNew = !chests.chests.has(ChestManager.key(x, y, z));
    const state = chests.getOrCreate(x, y, z);
    if (isNew && dimension === 'overworld' && generator.isRuinChest(x, y, z)) rollRuinLoot(state);
    invScreen.openChest(state);
    input.unlock();
    return true;
  }
  if (id === Block.LeverOff || id === Block.LeverOn) {
    redstone.toggleLever(world, (...a) => streamer.setBlock(...a), x, y, z);
    return true;
  }
  if (id === Block.ButtonOff) {
    redstone.pressButton(world, (...a) => streamer.setBlock(...a), x, y, z);
    return true;
  }
  if (id === Block.BrewingStand) {
    invScreen.openBrewing(brewing.getOrCreate(x, y, z));
    input.unlock();
    return true;
  }
  if (id === Block.EnchantingTable) {
    const result = tryEnchant(hotbar.selectedStack, (n) => player.spendLevels(n), (n) => inventory.removeById('lapis', n));
    if (result) {
      inventory.notify();
      sound.play('pickup');
    }
    return true;
  }
  return false;
};

// Particles + procedural sound feedback.
const particles = new Particles(game.scene);
const sound = new Sound();
sound.volume = settings.volume;

function isRedstoneRelated(id: Block): boolean {
  return id === Block.RedstoneWire || id === Block.RedstoneTorch
    || id === Block.LeverOff || id === Block.LeverOn
    || id === Block.ButtonOff || id === Block.ButtonOn
    || id === Block.RedstoneLampOff || id === Block.RedstoneLampOn;
}

function breakSoundFor(id: Block): 'break_stone' | 'break_wood' | 'break_dirt' {
  const def = blockDef(id);
  if (def.toolClass === 'pickaxe') return 'break_stone';
  if (def.toolClass === 'axe') return 'break_wood';
  return 'break_dirt';
}

// Leaf decay: chopping a log can orphan nearby leaves. Rather than tracking
// every leaf's connectivity continuously (vanilla's per-block BFS), this is a
// deliberate one-shot simplification — breaking a Log schedules a delayed
// connectivity check for every Leaves block within a 5-block box around it;
// if none of those still has a Log within 4 blocks when the check fires, it
// decays to Air (no drop — the random apple chance only applies to player
// breaks). No cascading re-checks, so a long-orphaned branch a leaf away from
// the checked radius may persist; acceptable for this game's scale.
const pendingLeafDecay: Array<{ x: number; y: number; z: number; timer: number }> = [];

function scheduleLeafDecayCheck(lx: number, ly: number, lz: number): void {
  for (let dz = -5; dz <= 5; dz++) {
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        if (dx * dx + dy * dy + dz * dz > 25) continue;
        const x = lx + dx, y = ly + dy, z = lz + dz;
        if (world.getBlock(x, y, z) === Block.Leaves) {
          pendingLeafDecay.push({ x, y, z, timer: 0.3 + Math.random() * 0.5 });
        }
      }
    }
  }
}

function hasNearbyLog(x: number, y: number, z: number): boolean {
  for (let dz = -4; dz <= 4; dz++) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (world.getBlock(x + dx, y + dy, z + dz) === Block.Log) return true;
      }
    }
  }
  return false;
}

// Water flow: removing a block next to water lets water spread into the
// newly-exposed Air, like vanilla. Falling straight down is unbounded (a
// shaft under a lake fills all the way), but sideways spread is capped by a
// hop count so a lake doesn't drain across the whole map — a deliberate
// simplification of vanilla's distance-from-source falloff. Delayed a few
// ticks per hop (instead of an instant flood-fill) so it visibly "flows".
const MAX_WATER_FLOW_DEPTH = 5;
const WATER_NEIGHBOR_OFFSETS: ReadonlyArray<[number, number, number]> = [
  [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
];
interface WaterFlowEntry { x: number; y: number; z: number; timer: number; depth: number; }
const pendingWaterFlow: WaterFlowEntry[] = [];
const queuedWaterFlowKeys = new Set<string>();

function waterFlowKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function hasWaterNeighbor(x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of WATER_NEIGHBOR_OFFSETS) {
    if (world.getBlock(x + dx, y + dy, z + dz) === Block.Water) return true;
  }
  return false;
}

function scheduleWaterFlowCheck(x: number, y: number, z: number, depth: number): void {
  if (depth > MAX_WATER_FLOW_DEPTH) return;
  const key = waterFlowKey(x, y, z);
  if (queuedWaterFlowKeys.has(key)) return;
  if (world.getBlock(x, y, z) !== Block.Air) return;
  queuedWaterFlowKeys.add(key);
  pendingWaterFlow.push({ x, y, z, timer: 0.12 + Math.random() * 0.1, depth });
}

/** Call whenever a block becomes Air (break, decay) — if it's now next to
 *  water, queue it to flow in. */
function notifyAirExposed(x: number, y: number, z: number): void {
  if (hasWaterNeighbor(x, y, z)) scheduleWaterFlowCheck(x, y, z, 0);
}

interaction.onBlockBroken = (id, x, y, z) => {
  // Furnaces/chests spill their contents.
  if (id === Block.Furnace) {
    for (const stack of furnaces.remove(x, y, z)) {
      entities.dropItem(stack, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
    }
  }
  if (id === Block.Chest) {
    for (const stack of chests.remove(x, y, z)) {
      entities.dropItem(stack, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
    }
  }
  if (id === Block.BrewingStand) {
    for (const stack of brewing.remove(x, y, z)) {
      entities.dropItem(stack, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
    }
  }
  if (id === Block.Log) scheduleLeafDecayCheck(x, y, z);
  if (dimension === 'overworld') notifyAirExposed(x, y, z);
  if (isRedstoneRelated(id)) redstone.markDirty();
  const oreXp: Partial<Record<Block, number>> = {
    [Block.CoalOre]: 1, [Block.IronOre]: 2, [Block.GoldOre]: 3, [Block.DiamondOre]: 5,
  };
  if (oreXp[id]) player.addXp(oreXp[id]!);
  const [r, g, b] = tileAverageColor(atlas, blockDef(id).tiles[0]);
  particles.burst(x + 0.5, y + 0.5, z + 0.5, r, g, b);
  sound.play(breakSoundFor(id), player.position.distanceTo(new THREE.Vector3(x, y, z)));
};
interaction.onBlockPlaced = (id) => {
  if (isRedstoneRelated(id)) redstone.markDirty();
  sound.play('place');
};
interaction.onToolBroke = () => sound.play('tool_break');
entities.onPickup = () => sound.play('pickup');
player.onDamage = () => {
  statsHud.flash();
  sound.play('hurt');
};

// Pause menu: shown whenever the pointer is unlocked (Esc opens it).
const menu = new Menu(
  document.body,
  {
    resume: () => input.requestLock(),
    setRenderDistance: (chunks) => {
      streamer.renderDistance = chunks;
    },
    setSensitivity: (mult) => {
      player.sensitivity = mult;
    },
    setVolume: (volume) => {
      sound.volume = volume;
    },
    exportWorld: () => saveManager.exportToFile(),
    toggleGameMode: () => {
      creativeMode = !creativeMode;
      player.creative = creativeMode;
      return creativeMode ? 'Creative' : 'Survival';
    },
  },
  creativeMode ? 'Creative' : 'Survival',
);
document.addEventListener('pointerlockchange', () => {
  if (input.isLocked) {
    menu.visible = false;
  } else {
    // Esc from gameplay → pause menu; but not when the inventory screen or
    // death screen deliberately released the lock.
    menu.visible = !invScreen.open && !tradeScreen.open && !player.dead;
    saveManager.save();
  }
});

let eatTimer = 0;

// Weather: a simple two-state timer (clear ↔ raining), overworld-only.
// Rain dims the sky/sun (DayNightCycle.raining), spawns falling particle
// streaks above the player, and plays a soft repeating patter sound.
let isRaining = false;
let weatherTimer = 60 + Math.random() * 120;
let rainParticleTimer = 0;
let rainSoundTimer = 0;

game.onUpdate((dt) => {
  // Game pauses (player/physics frozen) while any UI owns the pointer.
  // Discard input buffered during the pause so nothing fires on resume.
  if (!input.isLocked) {
    input.clearTransient();
    return;
  }

  // E opens the inventory (released lock keeps the pause menu hidden).
  if (input.justPressed('KeyE')) {
    invScreen.openScreen();
    input.unlock();
    input.clearTransient();
    return;
  }
  // Q tosses one of the selected item.
  if (input.justPressed('KeyQ')) {
    const stack = hotbar.selectedStack;
    if (stack) {
      inventory.consumeOne(hotbar.selected);
      const dir = player.lookDirection;
      const entity = entities.dropItem({ ...stack, count: 1 }, player.eyePosition.addScaledVector(dir, 0.4));
      entity.velocity.set(dir.x * 6, dir.y * 6 + 2, dir.z * 6);
      entity.pickupDelay = 1.5;
    }
  }

  player.update(dt, input);
  dayNight.update(dt, player.position, streamer.renderDistance, dimension);
  sky.setVisible(dimension === 'overworld');
  sky.update(dt, player.position, dayNight.sunDir, dayNight.daylight);
  hotbar.update(dt, input);

  // Melee: clicking a mob attacks it (and takes priority over mining).
  let hitMob = false;
  if (input.buttonJustPressed(0) && !player.dead) {
    const mob = mobs.raycastMob(player.eyePosition, player.lookDirection, 3.5);
    if (mob) {
      hitMob = true;
      const held = hotbar.selectedStack;
      const tool = held ? itemDef(held.id)?.tool : undefined;
      const damage = (tool?.damage ?? 1) + sharpnessBonus(held?.enchant) + (player.effects.strength > 0 ? 3 : 0);
      if (mob.hurt(damage, player.position)) player.addXp(5);
      sound.play('mob_hurt', mob.position.distanceTo(player.position));
      if (tool && held?.durability !== undefined && !player.creative && !unbreakingSavesDurability(held.enchant)) {
        held.durability--;
        if (held.durability <= 0) inventory.set(hotbar.selected, null);
        else inventory.notify();
      }
    }
  }

  // Trading: right-clicking a villager opens its trade screen — takes
  // priority over block-use/eating, same as the melee mob-priority above.
  let tradedThisTick = false;
  if (input.buttonJustPressed(2) && !player.dead) {
    const mob = mobs.raycastMob(player.eyePosition, player.lookDirection, 4);
    if (mob && mob.def.id === 'villager') {
      tradeScreen.show(mob);
      input.unlock();
      tradedThisTick = true;
    }
  }

  // Eating: hold RMB with food selected (1.2 s), then restore hunger.
  // Interactive blocks win over eating so a snack doesn't lock you out of
  // crafting tables and furnaces.
  const targetId = interaction.target?.id;
  const targetingInteractive = targetId === Block.CraftingTable || targetId === Block.Furnace || targetId === Block.Chest
    || targetId === Block.LeverOff || targetId === Block.LeverOn || targetId === Block.ButtonOff
    || targetId === Block.EnchantingTable || targetId === Block.BrewingStand;
  const held = hotbar.selectedStack;
  const food = held ? itemDef(held.id)?.food : undefined;
  const potion = held ? itemDef(held.id)?.potion : undefined;
  const canEat = food && !player.creative && player.hunger < 20;
  if (!tradedThisTick && (canEat || potion) && input.buttonDown(2) && !targetingInteractive) {
    eatTimer += dt;
    if (eatTimer >= (potion ? 0.8 : 1.2)) {
      eatTimer = 0;
      if (potion) {
        if (potion === 'healing') player.heal(6);
        else player.effects[potion] = 45;
        inventory.consumeOne(hotbar.selected);
        const leftover = inventory.add(makeStack('glass_bottle', 1));
        if (leftover > 0) entities.dropItem(makeStack('glass_bottle', leftover), player.position.clone());
      } else if (food) {
        player.eat(food.hunger, food.saturation);
        inventory.consumeOne(hotbar.selected);
      }
      sound.play('eat');
      const eye = player.eyePosition;
      const dir = player.lookDirection;
      particles.burst(eye.x + dir.x, eye.y + dir.y - 0.3, eye.z + dir.z, 0.8, 0.2, 0.2, 8);
    }
  } else {
    eatTimer = 0;
    if (!hitMob && !tradedThisTick) interaction.update(dt, input);
  }

  mobCtx.isDay = dayNight.isDay;
  mobCtx.dimension = dimension;
  mobs.update(dt, mobCtx);
  entities.update(dt, player.position, inventory);

  // Portal: standing in a NetherPortal/EndPortal block ~1.5s teleports to/from
  // the matching dimension.
  const feetId = world.getBlock(Math.floor(player.position.x), Math.floor(player.position.y), Math.floor(player.position.z));
  if (feetId === Block.NetherPortal || feetId === Block.EndPortal) {
    portalTimer += dt;
    if (portalTimer >= 1.5) {
      if (feetId === Block.NetherPortal) teleport(dimension === 'overworld' ? 'nether' : 'overworld');
      else teleport(dimension === 'overworld' ? 'end' : 'overworld');
    }
  } else {
    portalTimer = 0;
  }

  // Lava: standing in it burns for 4 damage every 0.5s (resistance halves it
  // automatically via the existing player.damage() effect handling).
  if (feetId === Block.Lava) {
    lavaTimer += dt;
    if (lavaTimer >= 0.5) {
      lavaTimer = 0;
      player.damage(4);
    }
  } else {
    lavaTimer = 0;
  }

  // Boss: spawn the Ender Dragon once per End visit, near the player's arrival point.
  if (dimension === 'end' && !dragonSpawnedThisVisit) {
    dragonSpawnedThisVisit = true;
    mobs.spawn('ender_dragon', player.position.clone().add(new THREE.Vector3(0, 8, -12)));
  }

  // Weather: toggle clear/raining on a timer, overworld-only.
  weatherTimer -= dt;
  if (weatherTimer <= 0) {
    isRaining = !isRaining;
    weatherTimer = isRaining ? 20 + Math.random() * 40 : 60 + Math.random() * 120;
  }
  const rainActive = isRaining && dimension === 'overworld';
  dayNight.raining = rainActive;
  if (rainActive) {
    rainParticleTimer -= dt;
    if (rainParticleTimer <= 0) {
      rainParticleTimer = 0.08;
      particles.rain(player.position.x, player.position.y + 10, player.position.z, 14, 6);
    }
    rainSoundTimer -= dt;
    if (rainSoundTimer <= 0) {
      rainSoundTimer = 0.35 + Math.random() * 0.2;
      sound.play('rain_patter');
    }
  }

  // Leaf decay: process any pending connectivity checks scheduled when a
  // nearby Log was broken (see scheduleLeafDecayCheck).
  for (let i = pendingLeafDecay.length - 1; i >= 0; i--) {
    const entry = pendingLeafDecay[i];
    entry.timer -= dt;
    if (entry.timer > 0) continue;
    pendingLeafDecay.splice(i, 1);
    if (world.getBlock(entry.x, entry.y, entry.z) !== Block.Leaves) continue;
    if (!hasNearbyLog(entry.x, entry.y, entry.z)) streamer.setBlock(entry.x, entry.y, entry.z, Block.Air);
  }

  // Water flow: process queued cells that were exposed next to water (see
  // notifyAirExposed/scheduleWaterFlowCheck). Only runs in the overworld —
  // the Nether/End never place Water, and queued positions are cleared on
  // dimension switch anyway (see teleport()).
  if (dimension === 'overworld') {
    for (let i = pendingWaterFlow.length - 1; i >= 0; i--) {
      const entry = pendingWaterFlow[i];
      entry.timer -= dt;
      if (entry.timer > 0) continue;
      pendingWaterFlow.splice(i, 1);
      queuedWaterFlowKeys.delete(waterFlowKey(entry.x, entry.y, entry.z));
      if (world.getBlock(entry.x, entry.y, entry.z) !== Block.Air) continue; // filled/built over meanwhile
      if (!hasWaterNeighbor(entry.x, entry.y, entry.z)) continue;
      streamer.setBlock(entry.x, entry.y, entry.z, Block.Water);
      // Falling is unbounded (depth resets), spreading sideways is capped.
      scheduleWaterFlowCheck(entry.x, entry.y - 1, entry.z, 0);
      scheduleWaterFlowCheck(entry.x + 1, entry.y, entry.z, entry.depth + 1);
      scheduleWaterFlowCheck(entry.x - 1, entry.y, entry.z, entry.depth + 1);
      scheduleWaterFlowCheck(entry.x, entry.y, entry.z + 1, entry.depth + 1);
      scheduleWaterFlowCheck(entry.x, entry.y, entry.z - 1, entry.depth + 1);
    }
  }

  // One-shot input is consumed per fixed tick — the loop can run twice in a
  // single rendered frame, and clearing per-frame double-fired key presses.
  input.endFrame();
});

const fpsEl = document.getElementById('fps')!;
game.onRender((_alpha, dt) => {
  saveManager.tick(dt);
  // Furnaces run on wall time so smelting continues while UIs are open.
  furnaces.tick(dt);
  brewing.tick(dt);
  redstone.tick(dt, world, (...a) => streamer.setBlock(...a));
  invScreen.tickFurnaceUI();
  particles.update(dt);
  streamer.update(player.position.x, player.position.z);
  chunkRenderer.update();
  player.applyToCamera(game.camera);
  statsHud.update(dt, player);
  debug.update(game, player, streamer, chunkRenderer, interaction, dayNight.clock);
  fpsEl.textContent = `FPS: ${game.fps}`;
});

// Set sun/sky/fog once so the world looks right behind the start menu.
dayNight.update(0, player.position, streamer.renderDistance, dimension);
sky.update(0, player.position, dayNight.sunDir, dayNight.daylight);
game.start();

// Console/dev hook for debugging and automated QA.
(window as unknown as Record<string, unknown>).vox = {
  setBlock: (x: number, y: number, z: number, id: number) => streamer.setBlock(x, y, z, id),
  getBlock: (x: number, y: number, z: number) => world.getBlock(x, y, z),
  save: () => saveManager.save(),
  player,
  seed: SEED,
  inventory,
  entities,
  invScreen,
  setCreative: (v: boolean) => { creativeMode = v; },
  breakAt: (x: number, y: number, z: number) => {
    // Simulate a fully-harvested player break (drops included) for QA.
    const id = world.getBlock(x, y, z);
    if (id === 0) return false;
    interaction['finishBreak']({ x, y, z, nx: 0, ny: 1, nz: 0, id }, true, false);
    return true;
  },
  interaction,
  furnaces,
  chests,
  redstone,
  brewing,
  mobs,
  tradeScreen,
  generator,
  game,
  chunkRenderer,
  lightAt: (x: number, y: number, z: number) => lightAt(world, x, y, z),
  get dimension() { return dimension; },
  netherGenerator,
  endGenerator,
  teleport,
  buildPortalPlatform,
  streamer,
  hotbar,
  dayNight,
  get isRaining() { return isRaining; },
  setRaining: (v: boolean) => { isRaining = v; weatherTimer = v ? 30 : 90; },
  scheduleLeafDecayCheck,
  hasNearbyLog,
  pendingLeafDecay,
  notifyAirExposed,
  hasWaterNeighbor,
  pendingWaterFlow,
};
