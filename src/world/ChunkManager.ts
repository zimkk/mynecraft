import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from './Chunk';

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/**
 * Holds the loaded chunk grid and provides world-coordinate block access
 * (used by the mesher for cross-chunk-boundary face culling, by physics,
 * and by the block edit raycast).
 */
export class ChunkManager {
  readonly chunks = new Map<string, Chunk>();

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  setChunk(chunk: Chunk): void {
    this.chunks.set(chunkKey(chunk.cx, chunk.cz), chunk);
  }

  removeChunk(cx: number, cz: number): void {
    this.chunks.delete(chunkKey(cx, cz));
  }

  /** World coords → block id. Air outside loaded chunks / vertical bounds. */
  getBlock(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return 0;
    return chunk.get(wx - cx * CHUNK_SIZE, wy, wz - cz * CHUNK_SIZE);
  }

  /**
   * World coords → set block. Marks the chunk dirty, plus any neighbor chunk
   * sharing the touched border (its mesh's culled faces depend on this block).
   */
  setBlock(wx: number, wy: number, wz: number, id: number): void {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return;
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    chunk.set(lx, wy, lz, id);

    // Neighbors always re-mesh: their border faces sample this chunk's
    // blocks for culling AND its light levels (which an edit can change
    // anywhere in the chunk, e.g. placing a torch).
    const markDirty = (ncx: number, ncz: number) => {
      const n = this.chunks.get(chunkKey(ncx, ncz));
      if (n) n.dirty = true;
    };
    markDirty(cx - 1, cz);
    markDirty(cx + 1, cz);
    markDirty(cx, cz - 1);
    markDirty(cx, cz + 1);
  }
}
