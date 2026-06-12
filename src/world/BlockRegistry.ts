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
  CoalOre = 11,
  IronOre = 12,
  GoldOre = 13,
  DiamondOre = 14,
  CraftingTable = 15,
  Furnace = 16,
  Torch = 17,
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
  CoalOre: 12,
  IronOre: 13,
  GoldOre: 14,
  DiamondOre: 15,
  CoalItem: 16,
  DiamondItem: 17,
  Stick: 18,
  IronIngot: 19,
  GoldIngot: 20,
  CraftingTableTop: 21,
  CraftingTableSide: 22,
  FurnaceFront: 23,
  FurnaceSide: 24,
  Torch: 25,
  /** Tool icons occupy tiles 26..55: 26 + classIndex*5 + tierIndex. */
  ToolBase: 26,
  /** Block-break crack stages occupy tiles 56..59. */
  CrackBase: 56,
  Apple: 60,
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
  /** Item id dropped when broken; null = nothing. Defaults to the block's own item. */
  drops: string | null;
  /** Base break time in seconds (Minecraft-style hardness). */
  hardness: number;
  /** Tool class that mines this block fastest. */
  toolClass?: 'pickaxe' | 'axe' | 'shovel' | 'sword';
  /** If true, drops nothing without the matching tool class at `minHarvest` tier. */
  requiresTool: boolean;
  /** Minimum tool harvest level for drops (0 = wood tier, 1 = stone, 2 = iron, 3 = diamond). */
  minHarvest: number;
  /** Player/entity physics collide with it. Defaults to `solid` (torches: false). */
  collidable: boolean;
  /** Non-cube render model. */
  model?: 'torch';
  /** Bonus drop rolled on break (e.g. apples from leaves). */
  randomDrop?: { id: string; chance: number };
}

interface DefExtra {
  drops?: string | null;
  hardness?: number;
  tool?: BlockDef['toolClass'];
  requiresTool?: boolean;
  minHarvest?: number;
}

function def(
  id: Block,
  name: string,
  solid: boolean,
  transparent: boolean,
  tiles: { all?: number; top?: number; bottom?: number; side?: number },
  extra: DefExtra = {},
): BlockDef {
  const side = tiles.side ?? tiles.all ?? 0;
  const top = tiles.top ?? tiles.all ?? side;
  const bottom = tiles.bottom ?? tiles.all ?? side;
  return {
    id, name, solid, transparent,
    tiles: [side, side, bottom, top, side, side],
    drops: extra.drops === undefined ? name.toLowerCase().replace(/ /g, '_') : extra.drops,
    hardness: extra.hardness ?? 1,
    toolClass: extra.tool,
    requiresTool: extra.requiresTool ?? false,
    minHarvest: extra.minHarvest ?? 0,
    collidable: solid,
  };
}

export const BLOCKS: readonly BlockDef[] = [
  def(Block.Air, 'Air', false, true, { all: 0 }, { drops: null, hardness: 0 }),
  def(Block.Grass, 'Grass', true, false, { top: Tile.GrassTop, bottom: Tile.Dirt, side: Tile.GrassSide }, { drops: 'dirt', hardness: 0.6, tool: 'shovel' }),
  def(Block.Dirt, 'Dirt', true, false, { all: Tile.Dirt }, { hardness: 0.5, tool: 'shovel' }),
  def(Block.Stone, 'Stone', true, false, { all: Tile.Stone }, { drops: 'cobblestone', hardness: 1.5, tool: 'pickaxe', requiresTool: true }),
  def(Block.Sand, 'Sand', true, false, { all: Tile.Sand }, { hardness: 0.5, tool: 'shovel' }),
  def(Block.Water, 'Water', false, true, { all: Tile.Water }, { drops: null, hardness: 0 }),
  def(Block.Log, 'Log', true, false, { top: Tile.LogEnd, bottom: Tile.LogEnd, side: Tile.LogSide }, { hardness: 2, tool: 'axe' }),
  // "Fast" leaves: rendered fully opaque so they occlude correctly and stay
  // out of the transparent pass (which has depth-write off and sorts poorly).
  {
    ...def(Block.Leaves, 'Leaves', true, false, { all: Tile.Leaves }, { drops: null, hardness: 0.25, tool: 'sword' }),
    randomDrop: { id: 'apple', chance: 0.08 },
  },
  def(Block.Plank, 'Plank', true, false, { all: Tile.Plank }, { drops: 'plank', hardness: 2, tool: 'axe' }),
  def(Block.Glass, 'Glass', true, true, { all: Tile.Glass }, { drops: null, hardness: 0.3 }),
  def(Block.Cobblestone, 'Cobblestone', true, false, { all: Tile.Cobblestone }, { hardness: 2, tool: 'pickaxe', requiresTool: true }),
  def(Block.CoalOre, 'Coal Ore', true, false, { all: Tile.CoalOre }, { drops: 'coal', hardness: 3, tool: 'pickaxe', requiresTool: true }),
  def(Block.IronOre, 'Iron Ore', true, false, { all: Tile.IronOre }, { drops: 'iron_ore', hardness: 3, tool: 'pickaxe', requiresTool: true, minHarvest: 1 }),
  def(Block.GoldOre, 'Gold Ore', true, false, { all: Tile.GoldOre }, { drops: 'gold_ore', hardness: 3, tool: 'pickaxe', requiresTool: true, minHarvest: 2 }),
  def(Block.DiamondOre, 'Diamond Ore', true, false, { all: Tile.DiamondOre }, { drops: 'diamond', hardness: 3, tool: 'pickaxe', requiresTool: true, minHarvest: 2 }),
  def(Block.CraftingTable, 'Crafting Table', true, false, { top: Tile.CraftingTableTop, bottom: Tile.Plank, side: Tile.CraftingTableSide }, { hardness: 2.5, tool: 'axe' }),
  def(Block.Furnace, 'Furnace', true, false, { all: Tile.FurnaceSide }, { hardness: 3.5, tool: 'pickaxe', requiresTool: true }),
  {
    // Torch: targetable (solid for raycast) but walk-through, custom mini model.
    ...def(Block.Torch, 'Torch', true, true, { all: Tile.Torch }, { hardness: 0.05 }),
    collidable: false,
    model: 'torch',
  },
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

/** Physics collision (torches are solid-for-targeting but walk-through). */
export function isCollidable(id: number): boolean {
  return blockDef(id).collidable;
}
