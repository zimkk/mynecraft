import * as THREE from 'three';
import { Game } from './core/Game';
import { Input } from './core/Input';
import { ChunkManager } from './world/ChunkManager';
import { ChunkStreamer } from './world/ChunkStreamer';
import { TerrainGenerator } from './terrain/TerrainGenerator';
import { buildAtlasTexture } from './rendering/TextureAtlas';
import { ChunkRenderer } from './rendering/ChunkRenderer';
import { Player } from './player/Player';
import { BlockInteraction } from './player/BlockInteraction';
import { Hotbar } from './ui/Hotbar';
import { DebugOverlay } from './ui/DebugOverlay';
import { DayNightCycle } from './rendering/DayNightCycle';
import { SaveManager, SaveData } from './save/SaveManager';

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
const streamer = new ChunkStreamer(world, generator, chunkRenderer, 6);
if (save) {
  for (const [key, id] of save.edits) streamer.edits.set(key, id);
}

// Pre-generate the spawn area synchronously so the player doesn't fall into void.
const spawnX = save?.player.x ?? 0.5;
const spawnZ = save?.player.z ?? 0.5;
while (!streamer.isAreaReady(spawnX, spawnZ)) {
  streamer.update(spawnX, spawnZ, 64);
}

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

// Interaction + UI
const interaction = new BlockInteraction(game.scene, world, streamer, player);
const hotbar = new Hotbar(document.body, atlas);
const debug = new DebugOverlay(document.body);
if (save) {
  hotbar.select(save.player.hotbarSlot);
  dayNight.time = save.time;
}

// Persistence: seed + edit delta + player state, autosaved to localStorage.
const saveManager = new SaveManager((): SaveData => ({
  version: 1,
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
}));

// "Click to play" hint, hidden while pointer is locked.
const hint = document.getElementById('hint')!;
document.addEventListener('pointerlockchange', () => {
  hint.style.display = input.isLocked ? 'none' : 'block';
});

game.onUpdate((dt) => {
  player.update(dt, input);
  dayNight.update(dt, player.position, streamer.renderDistance);
  hotbar.update(dt, input);
  interaction.update(dt, input, hotbar.selectedBlock);
});

const fpsEl = document.getElementById('fps')!;
game.onRender((_alpha, dt) => {
  saveManager.tick(dt);
  streamer.update(player.position.x, player.position.z);
  chunkRenderer.update();
  player.applyToCamera(game.camera);
  debug.update(input, game, player, streamer, chunkRenderer, interaction, dayNight.clock);
  fpsEl.textContent = `FPS: ${game.fps}`;
  input.endFrame();
});

game.start();

// Console/dev hook for debugging and automated QA.
(window as unknown as Record<string, unknown>).vox = {
  setBlock: (x: number, y: number, z: number, id: number) => streamer.setBlock(x, y, z, id),
  getBlock: (x: number, y: number, z: number) => world.getBlock(x, y, z),
  save: () => saveManager.save(),
  player,
  seed: SEED,
};
