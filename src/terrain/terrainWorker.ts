import { TerrainGenerator, type IWorldGenerator } from './TerrainGenerator';
import { NetherTerrainGenerator } from './NetherTerrainGenerator';
import { EndTerrainGenerator } from './EndTerrainGenerator';

/**
 * Terrain generation worker: receives chunk coordinates, returns the filled
 * block array as a transferable ArrayBuffer (zero-copy back to the main thread).
 */
type InMsg =
  | { type: 'init'; seed: string; kind: 'overworld' | 'nether' | 'end' }
  | { type: 'gen'; cx: number; cz: number };

let generator: IWorldGenerator | null = null;

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    generator = msg.kind === 'nether' ? new NetherTerrainGenerator(msg.seed)
      : msg.kind === 'end' ? new EndTerrainGenerator(msg.seed)
      : new TerrainGenerator(msg.seed);
    return;
  }
  if (!generator) return;
  const chunk = generator.generateChunk(msg.cx, msg.cz);
  (self as unknown as Worker).postMessage(
    { cx: msg.cx, cz: msg.cz, buffer: chunk.blocks.buffer },
    [chunk.blocks.buffer],
  );
};
