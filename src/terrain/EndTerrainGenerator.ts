import { createNoise3D, type NoiseFunction3D } from 'simplex-noise';
import { Chunk, CHUNK_SIZE } from '../world/Chunk';
import { Block } from '../world/BlockRegistry';
import { hashSeed, mulberry32, type IWorldGenerator, type VillageSpec } from './TerrainGenerator';

/** Floating islands sit in this Y band; everything else is void (Air). */
const ISLAND_MIN_Y = 46;
const ISLAND_MAX_Y = 78;
/** 3D noise above this threshold becomes solid End Stone. */
const ISLAND_THRESHOLD = 0.5;

/**
 * The End: a void scattered with floating End Stone islands, carved from 3D
 * simplex noise within a fixed height band (no floor/ceiling sandwich like
 * the Nether — just open void above and below). No trees, no villages, no ores.
 */
export class EndTerrainGenerator implements IWorldGenerator {
  private readonly islandNoise: NoiseFunction3D;
  private readonly seedNum: number;
  readonly seed: string;
  readonly kind = 'end' as const;

  constructor(seed: string) {
    this.seed = seed;
    this.seedNum = hashSeed(seed) ^ 0x3e4d3e4d;
    this.islandNoise = createNoise3D(mulberry32(this.seedNum));
  }

  /** No villages in the End. */
  nearestVillage(_wx: number, _wz: number, _radius: number): VillageSpec | null {
    return null;
  }

  generateChunk(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        // Islands taper off with distance from the origin (denser near spawn).
        const distFalloff = Math.max(0, 1 - Math.hypot(wx, wz) / 400);
        for (let y = ISLAND_MIN_Y; y <= ISLAND_MAX_Y; y++) {
          const n = this.islandNoise(wx * 0.06, y * 0.09, wz * 0.06);
          if (n + distFalloff * 0.25 > ISLAND_THRESHOLD) {
            chunk.blocks[Chunk.index(x, y, z)] = Block.EndStone;
          }
        }
      }
    }
    return chunk;
  }
}
