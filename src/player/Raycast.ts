import * as THREE from 'three';
import { ChunkManager } from '../world/ChunkManager';
import { isSolid } from '../world/BlockRegistry';

export interface RayHit {
  /** Block cell that was hit. */
  x: number; y: number; z: number;
  /** Normal of the face entered (unit axis vector) — the adjacent empty cell is hit + normal. */
  nx: number; ny: number; nz: number;
  id: number;
}

/**
 * Voxel traversal (Amanatides & Woo "fast voxel traversal" / DDA).
 * Walks the grid cell-by-cell along the ray: at each step, advance along the
 * axis whose next grid boundary is closest (smallest tMax). This visits every
 * cell the ray passes through, unlike sampling at fixed intervals.
 */
export function raycastVoxel(
  world: ChunkManager,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
): RayHit | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = Math.sign(dir.x);
  const stepY = Math.sign(dir.y);
  const stepZ = Math.sign(dir.z);

  // Distance along the ray to cross one full cell on each axis.
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  // Distance along the ray to the first grid boundary on each axis.
  let tMaxX = stepX > 0 ? (x + 1 - origin.x) * tDeltaX : stepX < 0 ? (origin.x - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - origin.y) * tDeltaY : stepY < 0 ? (origin.y - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ : stepZ < 0 ? (origin.z - z) * tDeltaZ : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let t = 0;

  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (isSolid(id) && t > 0) {
      return { x, y, z, nx, ny, nz, id };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX; tMaxX += tDeltaX; x += stepX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      t = tMaxY; tMaxY += tDeltaY; y += stepY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      t = tMaxZ; tMaxZ += tDeltaZ; z += stepZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}
