import { Chunk, CHUNK_SIZE } from './Chunk';
import { ChunkManager, chunkKey } from './ChunkManager';
import { TerrainGenerator } from '../terrain/TerrainGenerator';
import { ChunkRenderer } from '../rendering/ChunkRenderer';

/**
 * Streams chunks in and out around the player. Generation runs in Web Workers
 * (transferable block buffers) so the main thread never stalls; results are
 * integrated as they arrive, nearest-first. Chunks beyond renderDistance + 1
 * are unloaded (the +1 hysteresis avoids load/unload thrashing at the edge).
 */
export class ChunkStreamer {
  renderDistance: number;
  private readonly world: ChunkManager;
  private readonly generator: TerrainGenerator;
  private readonly renderer: ChunkRenderer;
  private readonly workers: Worker[] = [];
  private nextWorker = 0;
  private readonly pending = new Set<string>();
  /** Player-modified blocks to re-apply when a chunk regenerates: "wx,wy,wz" → id. */
  readonly edits = new Map<string, number>();

  private static readonly MAX_PENDING = 12;
  private static readonly WORKER_COUNT = Math.min(4, Math.max(2, (navigator.hardwareConcurrency ?? 4) - 2));

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

    for (let i = 0; i < ChunkStreamer.WORKER_COUNT; i++) {
      const worker = new Worker(new URL('../terrain/terrainWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.postMessage({ type: 'init', seed: generator.seed });
      worker.onmessage = (e: MessageEvent<{ cx: number; cz: number; buffer: ArrayBuffer }>) => {
        this.integrateChunk(e.data.cx, e.data.cz, new Uint8Array(e.data.buffer));
      };
      this.workers.push(worker);
    }
  }

  /** Call every frame with the player's world position. */
  update(px: number, pz: number): void {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const r = this.renderDistance;

    // Request missing chunks, nearest first, up to the in-flight cap.
    if (this.pending.size < ChunkStreamer.MAX_PENDING) {
      const missing: Array<{ cx: number; cz: number; d2: number }> = [];
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const d2 = dx * dx + dz * dz;
          if (d2 > r * r) continue;
          const cx = pcx + dx;
          const cz = pcz + dz;
          if (!this.world.getChunk(cx, cz) && !this.pending.has(chunkKey(cx, cz))) {
            missing.push({ cx, cz, d2 });
          }
        }
      }
      missing.sort((a, b) => a.d2 - b.d2);
      const budget = ChunkStreamer.MAX_PENDING - this.pending.size;
      for (let i = 0; i < Math.min(budget, missing.length); i++) {
        const { cx, cz } = missing[i];
        this.pending.add(chunkKey(cx, cz));
        this.workers[this.nextWorker].postMessage({ type: 'gen', cx, cz });
        this.nextWorker = (this.nextWorker + 1) % this.workers.length;
      }
    }

    // Unload chunks outside renderDistance + 1.
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

  /** Worker result → live chunk (also used by the synchronous spawn pre-gen). */
  private integrateChunk(cx: number, cz: number, blocks: Uint8Array): void {
    this.pending.delete(chunkKey(cx, cz));
    if (this.world.getChunk(cx, cz)) return; // already generated synchronously
    const chunk = new Chunk(cx, cz, blocks);
    this.applyEdits(chunk);
    this.world.setChunk(chunk);
    // Border faces of already-meshed neighbors may now be occluded — re-mesh them.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = this.world.getChunk(cx + dx, cz + dz);
      if (n) n.dirty = true;
    }
  }

  /** Synchronously generate everything around (px,pz) — used once at spawn. */
  pregenerate(px: number, pz: number): void {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const r = this.renderDistance;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        if (!this.world.getChunk(pcx + dx, pcz + dz)) {
          const chunk = this.generator.generateChunk(pcx + dx, pcz + dz);
          this.integrateChunk(chunk.cx, chunk.cz, chunk.blocks);
        }
      }
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
}

export { chunkKey };
