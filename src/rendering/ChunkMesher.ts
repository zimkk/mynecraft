import * as THREE from 'three';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from '../world/Chunk';
import { ChunkManager } from '../world/ChunkManager';
import { blockDef, isOpaque, Block } from '../world/BlockRegistry';
import { ATLAS_COLS, ATLAS_ROWS } from './TextureAtlas';

/**
 * Cube face table. For each direction: the outward normal, the four corner
 * positions (unit cube), their UVs, and a flat shade factor baked into vertex
 * colors (Minecraft-style directional shading: top brightest, bottom darkest).
 * Triangles are emitted as (0,1,2) and (2,1,3) — counter-clockwise from outside.
 */
const FACES: ReadonlyArray<{
  dir: [number, number, number];
  corners: ReadonlyArray<{ pos: [number, number, number]; uv: [number, number] }>;
  shade: number;
}> = [
  { // -X
    dir: [-1, 0, 0], shade: 0.75,
    corners: [
      { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] },
      { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] },
    ],
  },
  { // +X
    dir: [1, 0, 0], shade: 0.75,
    corners: [
      { pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] },
      { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] },
    ],
  },
  { // -Y (bottom)
    dir: [0, -1, 0], shade: 0.5,
    corners: [
      { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] },
    ],
  },
  { // +Y (top)
    dir: [0, 1, 0], shade: 1.0,
    corners: [
      { pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] },
    ],
  },
  { // -Z
    dir: [0, 0, -1], shade: 0.6,
    corners: [
      { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] },
    ],
  },
  { // +Z
    dir: [0, 0, 1], shade: 0.6,
    corners: [
      { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] },
    ],
  },
];

export interface ChunkMeshData {
  opaque: THREE.BufferGeometry | null;
  transparent: THREE.BufferGeometry | null;
}

interface GeoBuffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}

function newBuffers(): GeoBuffers {
  return { positions: [], normals: [], uvs: [], colors: [], indices: [] };
}

function toGeometry(b: GeoBuffers): THREE.BufferGeometry | null {
  if (b.indices.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
  g.setIndex(b.indices);
  return g;
}

/** Emit a free-standing box (used by the torch model): all 6 faces, one tile. */
function emitBox(
  buf: GeoBuffers,
  bx: number, by: number, bz: number,
  width: number, height: number,
  tile: number, tileW: number, tileH: number,
): void {
  const tu = (tile % ATLAS_COLS) * tileW;
  const tv = 1 - tileH - Math.floor(tile / ATLAS_COLS) * tileH;
  for (const face of FACES) {
    const vertBase = buf.positions.length / 3;
    for (const c of face.corners) {
      buf.positions.push(
        bx + c.pos[0] * width,
        by + c.pos[1] * height,
        bz + c.pos[2] * width,
      );
      buf.normals.push(face.dir[0], face.dir[1], face.dir[2]);
      buf.uvs.push(tu + c.uv[0] * tileW, tv + c.uv[1] * tileH);
      buf.colors.push(face.shade, face.shade, face.shade);
    }
    buf.indices.push(vertBase, vertBase + 1, vertBase + 2, vertBase + 2, vertBase + 1, vertBase + 3);
  }
}

/** Should `block`'s face touching `neighbor` be drawn? */
function faceVisible(block: number, neighbor: number): boolean {
  if (isOpaque(neighbor)) return false;
  // Skip internal faces between two blocks of the same transparent type
  // (e.g. inside a body of water or a glass wall).
  if (block === neighbor) return false;
  // Don't draw water faces against glass/leaves etc. — keep it simple: a
  // transparent block face is hidden only by opaque or same-type neighbors.
  return true;
}

/**
 * Builds geometry for one chunk, emitting only exposed faces. Neighbor lookups
 * go through the ChunkManager so faces on chunk borders are culled correctly.
 * Returns separate geometries for opaque and transparent (water/glass/leaves)
 * passes.
 */
export function meshChunk(chunk: Chunk, world: ChunkManager): ChunkMeshData {
  const opaque = newBuffers();
  const transparent = newBuffers();
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const tileW = 1 / ATLAS_COLS;
  const tileH = 1 / ATLAS_ROWS;

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = chunk.get(x, y, z);
        if (id === Block.Air) continue;
        const def = blockDef(id);

        // Non-cube models: torches render as a mini box, never culled.
        if (def.model === 'torch') {
          emitBox(transparent, x + 0.4375, y, z + 0.4375, 0.125, 0.625, def.tiles[0], tileW, tileH);
          continue;
        }

        const buf = def.transparent ? transparent : opaque;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];
          // In-chunk lookup when possible; world lookup across borders.
          const neighbor =
            nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE
              ? chunk.get(nx, ny, nz)
              : world.getBlock(baseX + nx, ny, baseZ + nz);
          if (!faceVisible(id, neighbor)) continue;

          const tile = def.tiles[f];
          const tu = (tile % ATLAS_COLS) * tileW;
          // Tile row 0 is at the top of the atlas image → highest V.
          const tv = 1 - tileH - Math.floor(tile / ATLAS_COLS) * tileH;
          const vertBase = buf.positions.length / 3;

          for (const c of face.corners) {
            buf.positions.push(x + c.pos[0], y + c.pos[1], z + c.pos[2]);
            buf.normals.push(face.dir[0], face.dir[1], face.dir[2]);
            buf.uvs.push(tu + c.uv[0] * tileW, tv + c.uv[1] * tileH);
            buf.colors.push(face.shade, face.shade, face.shade);
          }
          buf.indices.push(vertBase, vertBase + 1, vertBase + 2, vertBase + 2, vertBase + 1, vertBase + 3);
        }
      }
    }
  }

  return { opaque: toGeometry(opaque), transparent: toGeometry(transparent) };
}
