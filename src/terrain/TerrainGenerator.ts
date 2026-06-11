import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
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

/**
 * Heightmap terrain from layered (octave) simplex noise: each octave doubles
 * frequency and halves amplitude, giving large hills with fine detail on top.
 */
export class TerrainGenerator {
  private readonly noise2D: NoiseFunction2D;
  readonly seed: string;

  // Tuning knobs
  private static readonly BASE_HEIGHT = 34;
  private static readonly AMPLITUDE = 22;
  private static readonly FREQUENCY = 1 / 160;
  private static readonly OCTAVES = 4;

  constructor(seed: string) {
    this.seed = seed;
    this.noise2D = createNoise2D(mulberry32(hashSeed(seed)));
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
    return Math.max(1, Math.min(CHUNK_HEIGHT - 2, h));
  }

  generateChunk(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = this.heightAt(baseX + x, baseZ + z);
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
        // Fill water above terrain up to sea level.
        for (let y = h + 1; y <= WATER_LEVEL; y++) {
          chunk.blocks[Chunk.index(x, y, z)] = Block.Water;
        }
      }
    }
    return chunk;
  }
}
