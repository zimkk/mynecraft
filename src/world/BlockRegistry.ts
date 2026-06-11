/** Block type ids. Stored in chunk Uint8Arrays, so keep under 256. */
export enum Block {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Water = 5,
  Log = 6,
  Leaves = 7,
  Plank = 8,
  Glass = 9,
  Cobblestone = 10,
}

/** Atlas tile slots (filled by the runtime-generated texture atlas in /rendering). */
export const Tile = {
  GrassTop: 0,
  GrassSide: 1,
  Dirt: 2,
  Stone: 3,
  Sand: 4,
  Water: 5,
  LogSide: 6,
  LogEnd: 7,
  Leaves: 8,
  Plank: 9,
  Glass: 10,
  Cobblestone: 11,
} as const;

export interface BlockDef {
  id: Block;
  name: string;
  /** Player collides with it and it occludes neighbor faces (unless transparent). */
  solid: boolean;
  /** Rendered with alpha; does not occlude neighbor faces. */
  transparent: boolean;
  /** Tile index per face, in order: -X, +X, -Y (bottom), +Y (top), -Z, +Z. */
  tiles: [number, number, number, number, number, number];
}

function def(
  id: Block,
  name: string,
  solid: boolean,
  transparent: boolean,
  tiles: { all?: number; top?: number; bottom?: number; side?: number },
): BlockDef {
  const side = tiles.side ?? tiles.all ?? 0;
  const top = tiles.top ?? tiles.all ?? side;
  const bottom = tiles.bottom ?? tiles.all ?? side;
  return { id, name, solid, transparent, tiles: [side, side, bottom, top, side, side] };
}

export const BLOCKS: readonly BlockDef[] = [
  def(Block.Air, 'Air', false, true, { all: 0 }),
  def(Block.Grass, 'Grass', true, false, { top: Tile.GrassTop, bottom: Tile.Dirt, side: Tile.GrassSide }),
  def(Block.Dirt, 'Dirt', true, false, { all: Tile.Dirt }),
  def(Block.Stone, 'Stone', true, false, { all: Tile.Stone }),
  def(Block.Sand, 'Sand', true, false, { all: Tile.Sand }),
  def(Block.Water, 'Water', false, true, { all: Tile.Water }),
  def(Block.Log, 'Log', true, false, { top: Tile.LogEnd, bottom: Tile.LogEnd, side: Tile.LogSide }),
  // "Fast" leaves: rendered fully opaque so they occlude correctly and stay
  // out of the transparent pass (which has depth-write off and sorts poorly).
  def(Block.Leaves, 'Leaves', true, false, { all: Tile.Leaves }),
  def(Block.Plank, 'Plank', true, false, { all: Tile.Plank }),
  def(Block.Glass, 'Glass', true, true, { all: Tile.Glass }),
  def(Block.Cobblestone, 'Cobblestone', true, false, { all: Tile.Cobblestone }),
];

export function blockDef(id: number): BlockDef {
  return BLOCKS[id] ?? BLOCKS[Block.Air];
}

/** Opaque blocks fully occlude any face they touch. */
export function isOpaque(id: number): boolean {
  const d = blockDef(id);
  return d.solid && !d.transparent;
}

export function isSolid(id: number): boolean {
  return blockDef(id).solid;
}
