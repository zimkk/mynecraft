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

// World
const SEED = 'voxelcraft';
const world = new ChunkManager();
const generator = new TerrainGenerator(SEED);
const atlas = buildAtlasTexture();
const chunkRenderer = new ChunkRenderer(game.scene, world, atlas);
const streamer = new ChunkStreamer(world, generator, chunkRenderer, 6);

// Pre-generate the spawn area synchronously so the player doesn't fall into void.
while (!streamer.isAreaReady(0, 0)) {
  streamer.update(0, 0, 64);
}

// Player spawns on top of the terrain at the origin.
const player = new Player(world);
player.position.set(0.5, generator.heightAt(0, 0) + 1, 0.5);

// Interaction + UI
const interaction = new BlockInteraction(game.scene, world, streamer, player);
const hotbar = new Hotbar(document.body, atlas);
const debug = new DebugOverlay(document.body);

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
game.onRender(() => {
  streamer.update(player.position.x, player.position.z);
  chunkRenderer.update();
  player.applyToCamera(game.camera);
  debug.update(input, game, player, streamer, chunkRenderer, interaction, dayNight.clock);
  fpsEl.textContent = `FPS: ${game.fps}`;
  input.endFrame();
});

game.start();
