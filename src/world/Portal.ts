import { ChunkManager } from './ChunkManager';
import { Block } from './BlockRegistry';

const WIDTH = 4;
const HEIGHT = 5;

function isBorderCell(w: number, h: number): boolean {
  return w === 0 || w === WIDTH - 1 || h === 0 || h === HEIGHT - 1;
}

/**
 * Validate a minimal vanilla-style 4-wide × 5-tall ring of `borderBlock`
 * (2×3 interior) anchored on the clicked frame block at (x, y, z). Tries
 * both horizontal axes and every width/height offset (2 × 4 × 5 = 40
 * candidates) so the click can land on any frame cell, corner or edge.
 * Used for both Nether portals (Obsidian) and End portals (EndPortalFrame).
 *
 * Returns the interior cell coordinates (6 of them) to fill with the
 * matching portal block, or null if no valid frame is found.
 */
export function findPortalInterior(
  world: ChunkManager,
  x: number,
  y: number,
  z: number,
  borderBlock: Block = Block.Obsidian,
): Array<[number, number, number]> | null {
  for (const axis of ['x', 'z'] as const) {
    for (let wOff = 0; wOff < WIDTH; wOff++) {
      for (let hOff = 0; hOff < HEIGHT; hOff++) {
        const anchorW = (axis === 'x' ? z : x) - wOff;
        const anchorY = y - hOff;
        const fixed = axis === 'x' ? x : z;

        let valid = true;
        const interior: Array<[number, number, number]> = [];
        for (let w = 0; w < WIDTH && valid; w++) {
          for (let h = 0; h < HEIGHT && valid; h++) {
            const wx = axis === 'x' ? fixed : anchorW + w;
            const wz = axis === 'x' ? anchorW + w : fixed;
            const wy = anchorY + h;
            const id = world.getBlock(wx, wy, wz);
            if (isBorderCell(w, h)) {
              if (id !== borderBlock) valid = false;
            } else {
              if (id !== Block.Air) valid = false;
              else interior.push([wx, wy, wz]);
            }
          }
        }
        if (valid) return interior;
      }
    }
  }
  return null;
}
