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
import { StatsHud } from './ui/StatsHud';
import { MobManager } from './entities/MobManager';
import { Particles } from './rendering/Particles';
import { Sound } from './core/Sound';
import { blockDef } from './world/BlockRegistry';
import { tileAverageColor } from './rendering/TextureAtlas';
import { lightAt } from './rendering/Lighting';
import { itemDef } from './items/ItemRegistry';
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
// (chunk shader uniforms attached after the renderer is created below)

// World: resume the saved world, start a staged new one, or roll a random seed.
const newSeed = SaveManager.consumeNewSeed();
const save = newSeed === null ? SaveManager.load() : null;
const SEED = newSeed ?? save?.seed ?? Math.random().toString(36).slice(2, 10);

const world = new ChunkManager();
const generator = new TerrainGenerator(SEED);
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
}

// World spawn for respawns (where a fresh player would appear).
const worldSpawn = new THREE.Vector3(
  Math.floor(spawnX) + 0.5,
  generator.heightAt(Math.floor(spawnX), Math.floor(spawnZ)) + 1,
  Math.floor(spawnZ) + 0.5,
);

// Survival HUD + death flow: dying spills the inventory where you fell.
const statsHud = new StatsHud(document.body, () => {
  statsHud.showDeath(false);
  player.respawn(worldSpawn);
  game.renderer.domElement.requestPointerLock();
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
    game.renderer.domElement.requestPointerLock();
  },
});

// Mobs: spawned around the player (zombies at night, animals by day).
const mobs = new MobManager(game.scene, world, entities);
const mobCtx = {
  playerPos: player.position,
  isDay: true,
  attackPlayer: (mob: import('./entities/Mob').Mob) => {
    player.damage(mob.def.attackDamage ?? 2);
    player.knockback(player.position.x - mob.position.x, player.position.z - mob.position.z);
  },
};

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

// Particles + procedural sound feedback.
const particles = new Particles(game.scene);
const sound = new Sound();
sound.volume = settings.volume;

function breakSoundFor(id: Block): 'break_stone' | 'break_wood' | 'break_dirt' {
  const def = blockDef(id);
  if (def.toolClass === 'pickaxe') return 'break_stone';
  if (def.toolClass === 'axe') return 'break_wood';
  return 'break_dirt';
}

interaction.onBlockBroken = (id, x, y, z) => {
  // Furnaces spill their contents.
  if (id === Block.Furnace) {
    for (const stack of furnaces.remove(x, y, z)) {
      entities.dropItem(stack, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
    }
  }
  const [r, g, b] = tileAverageColor(atlas, blockDef(id).tiles[0]);
  particles.burst(x + 0.5, y + 0.5, z + 0.5, r, g, b);
  sound.play(breakSoundFor(id), player.position.distanceTo(new THREE.Vector3(x, y, z)));
};
interaction.onBlockPlaced = () => sound.play('place');
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
    resume: () => game.renderer.domElement.requestPointerLock(),
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
    menu.visible = !invScreen.open && !player.dead;
    saveManager.save();
  }
});

let eatTimer = 0;

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

  // Melee: clicking a mob attacks it (and takes priority over mining).
  let hitMob = false;
  if (input.buttonJustPressed(0) && !player.dead) {
    const mob = mobs.raycastMob(player.eyePosition, player.lookDirection, 3.5);
    if (mob) {
      hitMob = true;
      const held = hotbar.selectedStack;
      const tool = held ? itemDef(held.id)?.tool : undefined;
      mob.hurt(tool?.damage ?? 1, player.position);
      sound.play('mob_hurt', mob.position.distanceTo(player.position));
      if (tool && held?.durability !== undefined && !player.creative) {
        held.durability--;
        if (held.durability <= 0) inventory.set(hotbar.selected, null);
        else inventory.notify();
      }
    }
  }

  // Eating: hold RMB with food selected (1.2 s), then restore hunger.
  const held = hotbar.selectedStack;
  const food = held ? itemDef(held.id)?.food : undefined;
  if (food && input.buttonDown(2) && !player.creative && player.hunger < 20) {
    eatTimer += dt;
    if (eatTimer >= 1.2) {
      eatTimer = 0;
      player.eat(food.hunger, food.saturation);
      inventory.consumeOne(hotbar.selected);
      sound.play('eat');
      const eye = player.eyePosition;
      const dir = player.lookDirection;
      particles.burst(eye.x + dir.x, eye.y + dir.y - 0.3, eye.z + dir.z, 0.8, 0.2, 0.2, 8);
    }
  } else {
    eatTimer = 0;
    if (!hitMob) interaction.update(dt, input);
  }

  mobCtx.isDay = dayNight.isDay;
  mobs.update(dt, mobCtx);
  entities.update(dt, player.position, inventory);
});

const fpsEl = document.getElementById('fps')!;
game.onRender((_alpha, dt) => {
  saveManager.tick(dt);
  // Furnaces run on wall time so smelting continues while UIs are open.
  furnaces.tick(dt);
  invScreen.tickFurnaceUI();
  particles.update(dt);
  streamer.update(player.position.x, player.position.z);
  chunkRenderer.update();
  player.applyToCamera(game.camera);
  statsHud.update(dt, player);
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
  mobs,
  game,
  chunkRenderer,
  lightAt: (x: number, y: number, z: number) => lightAt(world, x, y, z),
};
