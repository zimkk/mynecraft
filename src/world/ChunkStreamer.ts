import { Chunk, CHUNK_SIZE } from './Chunk';
import { ChunkManager, chunkKey } from './ChunkManager';
import { TerrainGenerator } from '../terrain/TerrainGenerator';
import { ChunkRenderer } from '../rendering/ChunkRenderer';

/**
 * Streams chunks in and out around the player. Generates missing chunks
 * within `renderDistance` (a small budget per update to avoid hitches) and
 * unloads chunks beyond renderDistance + 1.
 */
export class ChunkStreamer {
  renderDistance: number;
  private readonly world: ChunkManager;
  private readonly generator: TerrainGenerator;
  private readonly renderer: ChunkRenderer;
  /** Player-modified blocks to re-apply when a chunk regenerates: "wx,wy,wz" → id. */
  readonly edits = new Map<string, number>();

  constructor(
    world: ChunkManager,
    generator: TerrainGenerator,
    renderer: ChunkRenderer,
    renderDistance = 6,
  ) {
    this.world = world;
    this.generator = generator;
    this.renderer = renderer;
    this.renderDistance = renderDistance;
  }

  /** Call every frame with the player's world position. */
  update(px: number, pz: number, maxGenPerFrame = 2): void {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const r = this.renderDistance;

    // Generate missing chunks, nearest first (spiral-ish via sorted ring list).
    const missing: Array<{ cx: number; cz: number; d2: number }> = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        if (!this.world.getChunk(cx, cz)) missing.push({ cx, cz, d2 });
      }
    }
    missing.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < Math.min(maxGenPerFrame, missing.length); i++) {
      this.loadChunk(missing[i].cx, missing[i].cz);
    }

    // Unload chunks outside renderDistance + 1 (hysteresis avoids thrashing).
    const unloadR2 = (r + 1) * (r + 1);
    for (const chunk of [...this.world.chunks.values()]) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (dx * dx + dz * dz > unloadR2) {
        this.world.removeChunk(chunk.cx, chunk.cz);
        this.renderer.removeChunkMesh(chunk.cx, chunk.cz);
      }
    }
  }

  private loadChunk(cx: number, cz: number): void {
    const chunk = this.generator.generateChunk(cx, cz);
    this.applyEdits(chunk);
    this.world.setChunk(chunk);
    // Border faces of already-meshed neighbors may now be occluded — re-mesh them.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = this.world.getChunk(cx + dx, cz + dz);
      if (n) n.dirty = true;
    }
  }

  /** Re-apply saved player edits that fall inside this chunk. */
  private applyEdits(chunk: Chunk): void {
    if (this.edits.size === 0) return;
    const baseX = chunk.cx * CHUNK_SIZE;
    const baseZ = chunk.cz * CHUNK_SIZE;
    for (const [key, id] of this.edits) {
      const [wx, wy, wz] = key.split(',').map(Number);
      const lx = wx - baseX;
      const lz = wz - baseZ;
      if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
        chunk.blocks[Chunk.index(lx, wy, lz)] = id;
      }
    }
  }

  /** Record a player edit and apply it to the live world. */
  setBlock(wx: number, wy: number, wz: number, id: number): void {
    this.edits.set(`${wx},${wy},${wz}`, id);
    this.world.setBlock(wx, wy, wz, id);
  }

  get loadedChunkCount(): number {
    return this.world.chunks.size;
  }

  /** True once every chunk within renderDistance of (px,pz) is generated. */
  isAreaReady(px: number, pz: number): boolean {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const r = this.renderDistance;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        if (!this.world.getChunk(pcx + dx, pcz + dz)) return false;
      }
    }
    return true;
  }
}

export { chunkKey };
