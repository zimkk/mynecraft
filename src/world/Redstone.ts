import { Block } from './BlockRegistry';
import { ChunkManager } from './ChunkManager';

/** Mutates a block and records it as a save-able edit (matches ChunkStreamer.setBlock). */
type SetBlockFn = (x: number, y: number, z: number, id: number) => void;

const NEIGHBORS: Array<[number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * Redstone "basics" v1: wire, an always-on torch, levers, timed buttons and
 * lamps. No repeaters/pistons/doors — those need block facing data the
 * chunk format doesn't carry yet (see PROGRESS.md Phase 22 notes).
 *
 * Power is recomputed by a BFS from sources whenever something changes
 * (placement/break/toggle), not every frame — the BFS itself walks the
 * loaded-chunk grid each time, which is cheap enough for occasional
 * recomputes but would be too slow to run at full tick rate.
 */
export class RedstoneManager {
  private buttonTimers = new Map<string, number>();
  private lampOn = new Set<string>();
  private dirty = true;

  markDirty(): void {
    this.dirty = true;
  }

  toggleLever(world: ChunkManager, setBlock: SetBlockFn, x: number, y: number, z: number): void {
    const id = world.getBlock(x, y, z);
    if (id === Block.LeverOff) setBlock(x, y, z, Block.LeverOn);
    else if (id === Block.LeverOn) setBlock(x, y, z, Block.LeverOff);
    else return;
    this.dirty = true;
  }

  pressButton(world: ChunkManager, setBlock: SetBlockFn, x: number, y: number, z: number): void {
    if (world.getBlock(x, y, z) !== Block.ButtonOff) return;
    setBlock(x, y, z, Block.ButtonOn);
    this.buttonTimers.set(key(x, y, z), 1);
    this.dirty = true;
  }

  tick(dt: number, world: ChunkManager, setBlock: SetBlockFn): void {
    for (const [k, remaining] of [...this.buttonTimers]) {
      const next = remaining - dt;
      if (next <= 0) {
        this.buttonTimers.delete(k);
        const [x, y, z] = k.split(',').map(Number);
        if (world.getBlock(x, y, z) === Block.ButtonOn) setBlock(x, y, z, Block.ButtonOff);
        this.dirty = true;
      } else {
        this.buttonTimers.set(k, next);
      }
    }

    if (!this.dirty) return;
    this.dirty = false;
    this.recompute(world, setBlock);
  }

  private recompute(world: ChunkManager, setBlock: SetBlockFn): void {
    const power = new Map<string, number>();
    const queue: Array<[number, number, number, number]> = [];

    for (const chunk of world.chunks.values()) {
      const baseX = chunk.cx * 16;
      const baseZ = chunk.cz * 16;
      for (let y = 0; y < 128; y++) {
        for (let lz = 0; lz < 16; lz++) {
          for (let lx = 0; lx < 16; lx++) {
            const id = chunk.get(lx, y, lz);
            if (id === Block.RedstoneTorch || id === Block.LeverOn || id === Block.ButtonOn) {
              queue.push([baseX + lx, y, baseZ + lz, 15]);
            }
          }
        }
      }
    }

    while (queue.length > 0) {
      const [x, y, z, p] = queue.shift()!;
      const k = key(x, y, z);
      if ((power.get(k) ?? 0) >= p) continue;
      power.set(k, p);
      if (p <= 1) continue;
      for (const [dx, dy, dz] of NEIGHBORS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (world.getBlock(nx, ny, nz) === Block.RedstoneWire) {
          queue.push([nx, ny, nz, p - 1]);
        }
      }
    }

    // Anything adjacent to a powered source or wire cell is "powered".
    const poweredCells = new Set<string>();
    for (const k of power.keys()) {
      const [x, y, z] = k.split(',').map(Number);
      poweredCells.add(k);
      for (const [dx, dy, dz] of NEIGHBORS) poweredCells.add(key(x + dx, y + dy, z + dz));
    }

    for (const chunk of world.chunks.values()) {
      const baseX = chunk.cx * 16;
      const baseZ = chunk.cz * 16;
      for (let y = 0; y < 128; y++) {
        for (let lz = 0; lz < 16; lz++) {
          for (let lx = 0; lx < 16; lx++) {
            const id = chunk.get(lx, y, lz);
            if (id !== Block.RedstoneLampOff && id !== Block.RedstoneLampOn) continue;
            const wx = baseX + lx, wz = baseZ + lz;
            const k = key(wx, y, wz);
            const shouldBeOn = poweredCells.has(k);
            if (shouldBeOn && id === Block.RedstoneLampOff) {
              setBlock(wx, y, wz, Block.RedstoneLampOn);
              this.lampOn.add(k);
            } else if (!shouldBeOn && id === Block.RedstoneLampOn) {
              setBlock(wx, y, wz, Block.RedstoneLampOff);
              this.lampOn.delete(k);
            }
          }
        }
      }
    }
  }

  toJSON(): Array<[string, number]> {
    return [...this.buttonTimers.entries()];
  }

  loadFrom(data: Array<[string, number]>): void {
    this.buttonTimers = new Map(data);
    this.dirty = true;
  }
}
