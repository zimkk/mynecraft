import { createNoise2D, createNoise3D, type NoiseFunction2D, type NoiseFunction3D } from 'simplex-noise';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from '../world/Chunk';
import { Block } from '../world/BlockRegistry';

export const WATER_LEVEL = 32;

/** Deterministic PRNG (mulberry32) used to seed the simplex noise. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string seed to a 32-bit int (FNV-1a). */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix integers into one 32-bit hash (for per-cell/per-chunk RNG streams). */
function hashCoords(a: number, b: number, c: number, d: number): number {
  let h = (a | 0) * 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= (b | 0) * 0x27d4eb2f;
  h = Math.imul(h ^ (h >>> 15), 0x165667b1);
  h ^= (c | 0) * 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b);
  h ^= d | 0;
  return h >>> 0;
}

interface TreeSpec {
  x: number;
  z: number;
  groundY: number;
  trunkHeight: number;
}

interface OreConfig {
  block: Block;
  attemptsPerChunk: number;
  minY: number;
  maxY: number;
  maxVein: number;
}

const ORES: OreConfig[] = [
  { block: Block.CoalOre, attemptsPerChunk: 14, minY: 5, maxY: 58, maxVein: 9 },
  { block: Block.IronOre, attemptsPerChunk: 10, minY: 5, maxY: 40, maxVein: 7 },
  { block: Block.GoldOre, attemptsPerChunk: 4, minY: 5, maxY: 22, maxVein: 5 },
  { block: Block.DiamondOre, attemptsPerChunk: 2, minY: 5, maxY: 14, maxVein: 5 },
];

/** One tree candidate per TREE_CELL×TREE_CELL world cell keeps trees spaced. */
const TREE_CELL = 8;
/** How far outside the chunk we look for tree anchors whose canopy reaches in. */
const TREE_MARGIN = 3;

/**
 * Heightmap terrain from layered (octave) simplex noise, decorated with
 * caves (3D noise carve), ore veins (seeded random walks in stone), and
 * trees (deterministic cell-anchored structures that straddle chunk borders
 * safely: every chunk independently evaluates all anchors whose canopy could
 * reach it and writes only the blocks that fall inside itself).
 */
export class TerrainGenerator {
  private readonly noise2D: NoiseFunction2D;
  private readonly caveNoise: NoiseFunction3D;
  private readonly seedNum: number;
  readonly seed: string;

  private static readonly BASE_HEIGHT = 34;
  private static readonly AMPLITUDE = 22;
  private static readonly FREQUENCY = 1 / 160;
  private static readonly OCTAVES = 4;
  private static readonly CAVE_THRESHOLD = 0.68;

  constructor(seed: string) {
    this.seed = seed;
    this.seedNum = hashSeed(seed);
    this.noise2D = createNoise2D(mulberry32(this.seedNum));
    this.caveNoise = createNoise3D(mulberry32(this.seedNum ^ 0x5eed));
  }

  /** Terrain height (top solid block y) at world column (wx, wz). */
  heightAt(wx: number, wz: number): number {
    let amp = 1;
    let freq = TerrainGenerator.FREQUENCY;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < TerrainGenerator.OCTAVES; o++) {
      sum += this.noise2D(wx * freq, wz * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    const n = sum / norm; // -1..1
    const h = Math.round(TerrainGenerator.BASE_HEIGHT + n * TerrainGenerator.AMPLITUDE);
    return Math.max(1, Math.min(CHUNK_HEIGHT - 10, h));
  }

  /** Deterministic tree anchor for the cell containing (wx, wz), if any. */
  private treeAt(wx: number, wz: number): TreeSpec | null {
    const cellX = Math.floor(wx / TREE_CELL);
    const cellZ = Math.floor(wz / TREE_CELL);
    const rng = mulberry32(hashCoords(this.seedNum, cellX, cellZ, 0x7133));
    const ox = 1 + Math.floor(rng() * (TREE_CELL - 2));
    const oz = 1 + Math.floor(rng() * (TREE_CELL - 2));
    if (cellX * TREE_CELL + ox !== wx || cellZ * TREE_CELL + oz !== wz) return null;
    if (rng() > 0.4) return null; // forest density
    const groundY = this.heightAt(wx, wz);
    if (groundY <= WATER_LEVEL + 1) return null; // no trees on beaches/underwater
    return { x: wx, z: wz, groundY, trunkHeight: 4 + Math.floor(rng() * 3) };
  }

  generateChunk(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    // --- Base terrain + caves ---
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const h = this.heightAt(wx, wz);
        const nearWater = h <= WATER_LEVEL + 1;

        for (let y = 0; y <= h; y++) {
          let id: number;
          if (y === h) {
            id = nearWater ? Block.Sand : Block.Grass;
          } else if (y >= h - 3) {
            id = nearWater ? Block.Sand : Block.Dirt;
          } else {
            id = Block.Stone;
          }
          chunk.blocks[Chunk.index(x, y, z)] = id;
        }
        for (let y = h + 1; y <= WATER_LEVEL; y++) {
          chunk.blocks[Chunk.index(x, y, z)] = Block.Water;
        }

        // Caves: carve 3D-noise tunnels through the stone layer, keeping a
        // 4-block roof under the surface and never under water columns
        // (avoids draining oceans into caves).
        if (!nearWater) {
          for (let y = 5; y < h - 4; y++) {
            if (this.caveNoise(wx * 0.075, y * 0.11, wz * 0.075) > TerrainGenerator.CAVE_THRESHOLD) {
              chunk.blocks[Chunk.index(x, y, z)] = Block.Air;
            }
          }
        }
      }
    }

    // --- Ore veins: short random walks replacing stone ---
    for (const ore of ORES) {
      const rng = mulberry32(hashCoords(this.seedNum, cx, cz, ore.block));
      for (let a = 0; a < ore.attemptsPerChunk; a++) {
        let x = Math.floor(rng() * CHUNK_SIZE);
        let z = Math.floor(rng() * CHUNK_SIZE);
        let y = ore.minY + Math.floor(rng() * (ore.maxY - ore.minY));
        const size = 3 + Math.floor(rng() * (ore.maxVein - 2));
        for (let i = 0; i < size; i++) {
          if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y > 0 && y < CHUNK_HEIGHT) {
            const idx = Chunk.index(x, y, z);
            if (chunk.blocks[idx] === Block.Stone) chunk.blocks[idx] = ore.block;
          }
          const dir = Math.floor(rng() * 6);
          if (dir === 0) x++; else if (dir === 1) x--;
          else if (dir === 2) y++; else if (dir === 3) y--;
          else if (dir === 4) z++; else z--;
        }
      }
    }

    // --- Trees (anchors within margin so canopies cross borders cleanly) ---
    for (let wz = baseZ - TREE_MARGIN; wz < baseZ + CHUNK_SIZE + TREE_MARGIN; wz++) {
      for (let wx = baseX - TREE_MARGIN; wx < baseX + CHUNK_SIZE + TREE_MARGIN; wx++) {
        const tree = this.treeAt(wx, wz);
        if (tree) this.writeTree(chunk, baseX, baseZ, tree);
      }
    }

    return chunk;
  }

  /** Write the parts of a tree that fall inside this chunk. */
  private writeTree(chunk: Chunk, baseX: number, baseZ: number, tree: TreeSpec): void {
    const top = tree.groundY + tree.trunkHeight;
    const put = (wx: number, wy: number, wz: number, id: Block, replaceSolid: boolean) => {
      const lx = wx - baseX;
      const lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
      if (wy < 0 || wy >= CHUNK_HEIGHT) return;
      const idx = Chunk.index(lx, wy, lz);
      if (!replaceSolid && chunk.blocks[idx] !== Block.Air) return;
      chunk.blocks[idx] = id;
    };

    // Canopy: two radius-2 layers below the top, radius-1 at the top, plus cap.
    const rng = mulberry32(hashCoords(this.seedNum, tree.x, tree.z, 0x7ee));
    for (let dy = -2; dy <= 1; dy++) {
      const y = top + dy;
      const radius = dy < 0 ? 2 : 1;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0 && dy <= 0) continue; // trunk goes here
          // Trim canopy corners randomly (but deterministically) for shape.
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && rng() < 0.6) continue;
          put(tree.x + dx, y, tree.z + dz, Block.Leaves, false);
        }
      }
    }
    // Trunk last so it punches through any leaves.
    for (let y = tree.groundY + 1; y <= top; y++) {
      put(tree.x, y, tree.z, Block.Log, true);
    }
  }
}
