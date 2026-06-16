import { createNoise3D, type NoiseFunction3D } from 'simplex-noise';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from '../world/Chunk';
import { Block } from '../world/BlockRegistry';
import { hashSeed, mulberry32, hashCoords, type IWorldGenerator, type VillageSpec } from './TerrainGenerator';

/** Solid floor band (Netherrack) — everything at/below this is bedrock-style filler. */
const FLOOR_Y = 4;
/** Solid ceiling band (Netherrack) — everything at/above this is filler. */
const CEILING_Y = 92;
/** 3D cavern carve threshold: noise above this is open air. */
const CAVERN_THRESHOLD = 0.42;

/**
 * Cavern-style Nether terrain: a solid floor/ceiling sandwich with the
 * interior carved into open caverns by 3D simplex noise. No surface
 * heightmap, no trees, no villages — just rock, lava seas, soul sand
 * patches, and glowstone studs.
 */
export class NetherTerrainGenerator implements IWorldGenerator {
  private readonly caveNoise: NoiseFunction3D;
  private readonly seedNum: number;
  readonly seed: string;
  readonly kind = 'nether' as const;

  constructor(seed: string) {
    this.seed = seed;
    this.seedNum = hashSeed(seed) ^ 0x4ee741; // distinct stream from the overworld cave noise
    this.caveNoise = createNoise3D(mulberry32(this.seedNum));
  }

  /** No villages in the Nether. */
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
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          let id: number = Block.Air;
          if (y <= FLOOR_Y || y >= CEILING_Y) {
            id = Block.Netherrack;
          } else {
            const n = this.caveNoise(wx * 0.07, y * 0.09, wz * 0.07);
            if (n <= CAVERN_THRESHOLD) id = Block.Netherrack;
          }
          chunk.blocks[Chunk.index(x, y, z)] = id;
        }

        // Soul sand patches on the cavern floor (low-probability per-column).
        const soulRng = mulberry32(hashCoords(this.seedNum, wx, wz, 0x501));
        if (soulRng() < 0.04) {
          const idx = Chunk.index(x, FLOOR_Y, z);
          if (chunk.blocks[idx] === Block.Netherrack) chunk.blocks[idx] = Block.SoulSand;
        }

        // Bedrock caps top and bottom — digging through the Netherrack floor
        // or ceiling would otherwise expose the void above/below the world.
        chunk.blocks[Chunk.index(x, 0, z)] = Block.Bedrock;
        chunk.blocks[Chunk.index(x, CHUNK_HEIGHT - 1, z)] = Block.Bedrock;
      }
    }

    // Lava: fill leftover Air just above the floor band (lava seas).
    const lavaRng = mulberry32(hashCoords(this.seedNum, cx, cz, 0xface));
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let y = FLOOR_Y + 1; y <= FLOOR_Y + 6; y++) {
          const idx = Chunk.index(x, y, z);
          if (chunk.blocks[idx] === Block.Air && lavaRng() < 0.5) {
            chunk.blocks[idx] = Block.Lava;
          }
        }
      }
    }

    // Glowstone: low-probability studs on Netherrack whose underside is open.
    const glowRng = mulberry32(hashCoords(this.seedNum, cx, cz, 0x910));
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let y = FLOOR_Y + 1; y < CEILING_Y; y++) {
          const idx = Chunk.index(x, y, z);
          if (chunk.blocks[idx] !== Block.Netherrack) continue;
          const belowIdx = Chunk.index(x, y - 1, z);
          if (chunk.blocks[belowIdx] === Block.Air && glowRng() < 0.015) {
            chunk.blocks[idx] = Block.Glowstone;
          }
        }
      }
    }

    return chunk;
  }
}
