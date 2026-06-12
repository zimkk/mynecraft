import * as THREE from 'three';
import { Game } from './core/Game';
import { Input } from './core/Input';
import { ChunkManager } from './world/ChunkManager';
import { Block } from './world/BlockRegistry';
import { ChunkStreamer } from './world/ChunkStreamer';
import { TerrainGenerator, WATER_LEVEL } from './terrain/TerrainGenerator';
import { buildAtlasTexture } from './rendering/TextureAtlas';
import { ChunkRenderer } from './rendering/ChunkRenderer';
import { Player } from './player/Player';
import { BlockInteraction } from './player/BlockInteraction';
import { Hotbar } from './ui/Hotbar';
import { DebugOverlay } from './ui/DebugOverlay';
import { DayNightCycle } from './rendering/DayNightCycle';
import { SaveManager, SaveData, SAVE_VERSION } from './save/SaveManager';
import { Inventory } from './items/Inventory';
import { EntityManager } from './entities/EntityManager';
import { InventoryScreen } from './ui/InventoryScreen';
import { FurnaceManager } from './world/Furnace';
import { Menu, loadRenderDistance } from './ui/Menu';

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

// World: resume the saved world, start a staged new one, or roll a random seed.
const newSeed = SaveManager.consumeNewSeed();
const save = newSeed === null ? SaveManager.load() : null;
const SEED = newSeed ?? save?.seed ?? Math.random().toString(36).slice(2, 10);

const world = new ChunkManager();
const generator = new TerrainGenerator(SEED);
const atlas = buildAtlasTexture();
const chunkRenderer = new ChunkRenderer(game.scene, world, atlas);
const streamer = new ChunkStreamer(world, generator, chunkRenderer, loadRenderDistance());
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
}));

// Game mode: runtime flag for now; Phase 17 wires full survival/creative rules.
let creativeMode = false;

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
    game.renderer.domElement.requestPointerLock();
  },
});

// Furnace block entities (smelting continues on wall time, even paused).
const furnaces = new FurnaceManager();
if (save?.furnaces?.length) furnaces.loadFrom(save.furnaces);

// Right-clicking interactive blocks opens their UI instead of placing.
interaction.onUseBlock = (id, x, y, z) => {
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
  return false;
};

// Breaking a furnace spills its contents.
interaction.onBlockBroken = (id, x, y, z) => {
  if (id === Block.Furnace) {
    for (const stack of furnaces.remove(x, y, z)) {
      entities.dropItem(stack, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
    }
  }
};

// Pause menu: shown whenever the pointer is unlocked (Esc opens it).
const menu = new Menu(
  document.body,
  {
    resume: () => game.renderer.domElement.requestPointerLock(),
    setRenderDistance: (chunks) => {
      streamer.renderDistance = chunks;
    },
    exportWorld: () => saveManager.exportToFile(),
    toggleGameMode: () => {
      creativeMode = !creativeMode;
      return creativeMode ? 'Creative' : 'Survival';
    },
  },
  streamer.renderDistance,
);
document.addEventListener('pointerlockchange', () => {
  if (input.isLocked) {
    menu.visible = false;
  } else {
    // Esc from gameplay → pause menu; but not when the inventory screen
    // deliberately released the lock.
    menu.visible = !invScreen.open;
    saveManager.save();
  }
});

game.onUpdate((dt) => {
  // Game pauses (player/physics frozen) while any UI owns the pointer.
  if (!input.isLocked) return;

  // E opens the inventory (released lock keeps the pause menu hidden).
  if (input.justPressed('KeyE')) {
    invScreen.openScreen();
    input.unlock();
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
  dayNight.update(dt, player.position, streamer.renderDistance);
  hotbar.update(dt, input);
  interaction.update(dt, input);
  entities.update(dt, player.position, inventory);
});

const fpsEl = document.getElementById('fps')!;
game.onRender((_alpha, dt) => {
  saveManager.tick(dt);
  // Furnaces run on wall time so smelting continues while UIs are open.
  furnaces.tick(dt);
  invScreen.tickFurnaceUI();
  streamer.update(player.position.x, player.position.z);
  chunkRenderer.update();
  player.applyToCamera(game.camera);
  debug.update(input, game, player, streamer, chunkRenderer, interaction, dayNight.clock);
  fpsEl.textContent = `FPS: ${game.fps}`;
  input.endFrame();
});

// Set sun/sky/fog once so the world looks right behind the start menu.
dayNight.update(0, player.position, streamer.renderDistance);
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
};
