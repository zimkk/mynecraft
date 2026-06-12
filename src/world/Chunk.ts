export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 128;

/**
 * A CHUNK_SIZE × CHUNK_HEIGHT × CHUNK_SIZE column of blocks stored as a flat
 * Uint8Array. Index layout: x + z*SIZE + y*SIZE*SIZE so a full horizontal
 * slice is contiguous per y level.
 */
export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
  /** Per-cell light levels 0-15, computed by the light engine on demand. */
  skyLight: Uint8Array | null = null;
  blockLight: Uint8Array | null = null;
  /** Set when blocks change and the mesh needs rebuilding. */
  dirty = true;
  /** Set when blocks change and lighting must be recomputed before meshing. */
  lightDirty = true;

  constructor(cx: number, cz: number, blocks?: Uint8Array) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = blocks ?? new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
  }

  static index(x: number, y: number, z: number): number {
    return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
  }

  /** Local coordinates; returns Air (0) outside vertical bounds. */
  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    return this.blocks[Chunk.index(x, y, z)];
  }

  set(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    this.blocks[Chunk.index(x, y, z)] = id;
    this.dirty = true;
    this.lightDirty = true;
  }
}
