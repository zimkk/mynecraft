import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from '../world/Chunk';
import { ChunkManager } from '../world/ChunkManager';
import { isOpaque, Block } from '../world/BlockRegistry';

const CELLS = CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE;
export const TORCH_LIGHT = 14;

// Scratch BFS queue (chunk-local cell indices), reused across computations.
const queue = new Int32Array(CELLS);

/**
 * Per-chunk lighting: skylight pours down each column (attenuated by water),
 * torch light radiates from emitters, and both flood-fill (BFS, −1 per step)
 * through non-opaque cells. The fill is confined to the chunk — light does
 * not cross chunk borders, a deliberate simplification that keeps edits
 * O(one chunk); seams are rarely noticeable with the ambient floor.
 */
export function computeChunkLight(chunk: Chunk): void {
  if (!chunk.skyLight) chunk.skyLight = new Uint8Array(CELLS);
  if (!chunk.blockLight) chunk.blockLight = new Uint8Array(CELLS);
  const sky = chunk.skyLight;
  const blk = chunk.blockLight;
  const blocks = chunk.blocks;
  sky.fill(0);
  blk.fill(0);

  let qLen = 0;

  // --- Skylight: pour straight down per column ---
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      let level = 15;
      for (let y = CHUNK_HEIGHT - 1; y >= 0 && level > 0; y--) {
        const idx = Chunk.index(x, y, z);
        const id = blocks[idx];
        if (isOpaque(id)) break;
        if (id === Block.Water) level = Math.max(0, level - 2);
        sky[idx] = level;
        queue[qLen++] = idx;
      }
    }
  }
  bfs(sky, blocks, qLen);

  // --- Block light: torches ---
  qLen = 0;
  for (let idx = 0; idx < CELLS; idx++) {
    if (blocks[idx] === Block.Torch) {
      blk[idx] = TORCH_LIGHT;
      queue[qLen++] = idx;
    }
  }
  if (qLen > 0) bfs(blk, blocks, qLen);

  chunk.lightDirty = false;
}

/** Flood-fill: spread light to 6-neighbors at level−1 through non-opaque cells. */
function bfs(light: Uint8Array, blocks: Uint8Array, qLen: number): void {
  const sliceY = CHUNK_SIZE * CHUNK_SIZE;
  let head = 0;
  while (head < qLen) {
    const idx = queue[head++];
    const level = light[idx];
    if (level <= 1) continue;
    const x = idx % CHUNK_SIZE;
    const z = ((idx / CHUNK_SIZE) | 0) % CHUNK_SIZE;
    const y = (idx / sliceY) | 0;

    // Neighbor offsets with bounds checks unrolled for speed.
    if (x > 0) spread(idx - 1);
    if (x < CHUNK_SIZE - 1) spread(idx + 1);
    if (z > 0) spread(idx - CHUNK_SIZE);
    if (z < CHUNK_SIZE - 1) spread(idx + CHUNK_SIZE);
    if (y > 0) spread(idx - sliceY);
    if (y < CHUNK_HEIGHT - 1) spread(idx + sliceY);

    function spread(n: number): void {
      if (light[n] >= level - 1) return;
      if (isOpaque(blocks[n])) return;
      light[n] = level - 1;
      if (qLen < CELLS) queue[qLen++] = n;
    }
  }
}

/**
 * World-coordinate light lookup used by the mesher for face lighting.
 * Returns [sky, block], computing the target chunk's light lazily.
 * Above the world or in unloaded chunks: full skylight.
 */
export function lightAt(world: ChunkManager, wx: number, wy: number, wz: number): [number, number] {
  if (wy >= CHUNK_HEIGHT) return [15, 0];
  if (wy < 0) return [0, 0];
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const chunk = world.getChunk(cx, cz);
  if (!chunk) return [15, 0];
  if (chunk.lightDirty || !chunk.skyLight) computeChunkLight(chunk);
  const idx = Chunk.index(wx - cx * CHUNK_SIZE, wy, wz - cz * CHUNK_SIZE);
  return [chunk.skyLight![idx], chunk.blockLight![idx]];
}
