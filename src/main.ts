import * as THREE from 'three';
import { Game } from './core/Game';
import { Input } from './core/Input';
import { ChunkManager } from './world/ChunkManager';
import { ChunkStreamer } from './world/ChunkStreamer';
import { TerrainGenerator } from './terrain/TerrainGenerator';
import { buildAtlasTexture } from './rendering/TextureAtlas';
import { ChunkRenderer } from './rendering/ChunkRenderer';
import { Player } from './player/Player';

const app = document.getElementById('app')!;
const game = new Game(app);
const input = new Input(game.renderer.domElement);

// Lights
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(0.5, 1, 0.3).normalize();
game.scene.add(sun);
game.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

// World
const SEED = 'voxelcraft';
const world = new ChunkManager();
const generator = new TerrainGenerator(SEED);
const chunkRenderer = new ChunkRenderer(game.scene, world, buildAtlasTexture());
const streamer = new ChunkStreamer(world, generator, chunkRenderer, 6);

// Pre-generate the spawn area synchronously so the player doesn't fall into void.
while (!streamer.isAreaReady(0, 0)) {
  streamer.update(0, 0, 64);
}

// Player spawns on top of the terrain at the origin.
const player = new Player(world);
player.position.set(0.5, generator.heightAt(0, 0) + 1, 0.5);

game.onUpdate((dt) => {
  player.update(dt, input);
});

const fpsEl = document.getElementById('fps')!;
game.onRender(() => {
  streamer.update(player.position.x, player.position.z);
  chunkRenderer.update();
  player.applyToCamera(game.camera);
  fpsEl.textContent =
    `FPS: ${game.fps} | chunks: ${streamer.loadedChunkCount} | ` +
    `pos: ${player.position.x.toFixed(1)},${player.position.y.toFixed(1)},${player.position.z.toFixed(1)}` +
    (player.flying ? ' | FLY' : '');
  input.endFrame();
});

game.start();
