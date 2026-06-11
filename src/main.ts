import * as THREE from 'three';
import { Game } from './core/Game';
import { Chunk, CHUNK_SIZE } from './world/Chunk';
import { ChunkManager } from './world/ChunkManager';
import { Block } from './world/BlockRegistry';
import { buildAtlasTexture } from './rendering/TextureAtlas';
import { ChunkRenderer } from './rendering/ChunkRenderer';

const app = document.getElementById('app')!;
const game = new Game(app);

// Lights
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(0.5, 1, 0.3).normalize();
game.scene.add(sun);
game.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

// World: flat 4×4 chunk test area — stone below, dirt layer, grass on top.
const world = new ChunkManager();
const GROUND_Y = 24;
for (let cx = 0; cx < 4; cx++) {
  for (let cz = 0; cz < 4; cz++) {
    const chunk = new Chunk(cx, cz);
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let y = 0; y <= GROUND_Y; y++) {
          let id: number = Block.Stone;
          if (y === GROUND_Y) id = Block.Grass;
          else if (y >= GROUND_Y - 3) id = Block.Dirt;
          chunk.set(x, y, z, id);
        }
      }
    }
    world.setChunk(chunk);
  }
}

// A few feature blocks to eyeball per-face textures and transparency.
world.setBlock(32, GROUND_Y + 1, 32, Block.Log);
world.setBlock(32, GROUND_Y + 2, 32, Block.Log);
world.setBlock(32, GROUND_Y + 3, 32, Block.Leaves);
world.setBlock(34, GROUND_Y + 1, 32, Block.Glass);
world.setBlock(36, GROUND_Y + 1, 32, Block.Cobblestone);
world.setBlock(38, GROUND_Y + 1, 32, Block.Plank);
world.setBlock(40, GROUND_Y + 1, 32, Block.Sand);

const renderer = new ChunkRenderer(game.scene, world, buildAtlasTexture());

// Static fly-over camera for this phase (player controller comes in Phase 5).
game.camera.position.set(32, GROUND_Y + 14, 76);
game.camera.lookAt(32, GROUND_Y, 32);

const fpsEl = document.getElementById('fps')!;
game.onRender(() => {
  renderer.update();
  fpsEl.textContent = `FPS: ${game.fps} | tris: ${renderer.triangleCount}`;
});

game.start();
