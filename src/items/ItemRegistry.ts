import { Block, Tile, blockDef } from '../world/BlockRegistry';

export type ItemType = 'block' | 'tool' | 'material' | 'food' | 'misc';

export type ToolClass = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'hoe';

/** Tool material tiers, in harvest-level order. */
export type ToolTier = 'wood' | 'stone' | 'iron' | 'gold' | 'diamond';

export interface ToolDef {
  class: ToolClass;
  tier: ToolTier;
  /** Mining speed multiplier when used on a matching block. */
  speed: number;
  /** Blocks requiring a higher harvest level than this drop nothing. */
  harvestLevel: number;
  maxDurability: number;
  /** Melee damage (swords are high, others modest). */
  damage: number;
}

export interface FoodDef {
  hunger: number;
  saturation: number;
}

export interface ItemDef {
  id: string;
  name: string;
  type: ItemType;
  maxStack: number;
  /** Atlas tile used for the inventory/hotbar icon (and drop-entity faces). */
  icon: number;
  /** For type 'block': the block this item places. */
  blockId?: Block;
  tool?: ToolDef;
  food?: FoodDef;
}

export interface ItemStack {
  id: string;
  count: number;
  durability?: number;
}

const REGISTRY = new Map<string, ItemDef>();

function register(def: ItemDef): void {
  REGISTRY.set(def.id, def);
}

/** Register one placeable item per block type, icon = the block's top tile. */
function registerBlockItem(blockId: Block, id: string, name: string): void {
  register({ id, name, type: 'block', maxStack: 64, icon: blockDef(blockId).tiles[3], blockId });
}

registerBlockItem(Block.Grass, 'grass', 'Grass Block');
registerBlockItem(Block.Dirt, 'dirt', 'Dirt');
registerBlockItem(Block.Stone, 'stone', 'Stone');
registerBlockItem(Block.Sand, 'sand', 'Sand');
registerBlockItem(Block.Log, 'log', 'Log');
registerBlockItem(Block.Leaves, 'leaves', 'Leaves');
registerBlockItem(Block.Plank, 'plank', 'Planks');
registerBlockItem(Block.Glass, 'glass', 'Glass');
registerBlockItem(Block.Cobblestone, 'cobblestone', 'Cobblestone');
registerBlockItem(Block.CoalOre, 'coal_ore', 'Coal Ore');
registerBlockItem(Block.IronOre, 'iron_ore', 'Iron Ore');
registerBlockItem(Block.GoldOre, 'gold_ore', 'Gold Ore');
registerBlockItem(Block.DiamondOre, 'diamond_ore', 'Diamond Ore');

// Materials.
register({ id: 'coal', name: 'Coal', type: 'material', maxStack: 64, icon: Tile.CoalItem });
register({ id: 'diamond', name: 'Diamond', type: 'material', maxStack: 64, icon: Tile.DiamondItem });
register({ id: 'stick', name: 'Stick', type: 'material', maxStack: 64, icon: Tile.Stick });
register({ id: 'iron_ingot', name: 'Iron Ingot', type: 'material', maxStack: 64, icon: Tile.IronIngot });
register({ id: 'gold_ingot', name: 'Gold Ingot', type: 'material', maxStack: 64, icon: Tile.GoldIngot });

registerBlockItem(Block.CraftingTable, 'crafting_table', 'Crafting Table');
registerBlockItem(Block.Furnace, 'furnace', 'Furnace');
registerBlockItem(Block.Torch, 'torch', 'Torch');

// ---- Tools: one item per class × tier, icons from the atlas tool grid ----

const TOOL_CLASS_LIST: ToolClass[] = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
const TOOL_TIER_LIST: ToolTier[] = ['wood', 'stone', 'iron', 'gold', 'diamond'];

const TIER_STATS: Record<ToolTier, { speed: number; harvestLevel: number; durability: number; prefix: string }> = {
  wood: { speed: 2, harvestLevel: 0, durability: 60, prefix: 'Wooden' },
  stone: { speed: 4, harvestLevel: 1, durability: 132, prefix: 'Stone' },
  iron: { speed: 6, harvestLevel: 2, durability: 251, prefix: 'Iron' },
  gold: { speed: 12, harvestLevel: 0, durability: 33, prefix: 'Golden' },
  diamond: { speed: 8, harvestLevel: 3, durability: 1025, prefix: 'Diamond' },
};

const TIER_DAMAGE: Record<ToolTier, number> = { wood: 1, stone: 2, iron: 3, gold: 1, diamond: 4 };

for (let c = 0; c < TOOL_CLASS_LIST.length; c++) {
  for (let t = 0; t < TOOL_TIER_LIST.length; t++) {
    const cls = TOOL_CLASS_LIST[c];
    const tier = TOOL_TIER_LIST[t];
    const stats = TIER_STATS[tier];
    const baseDamage = cls === 'sword' ? 3 : cls === 'axe' ? 2 : 1;
    register({
      id: `${tier === 'wood' ? 'wooden' : tier === 'gold' ? 'golden' : tier}_${cls}`,
      name: `${stats.prefix} ${cls[0].toUpperCase()}${cls.slice(1)}`,
      type: 'tool',
      maxStack: 1,
      icon: Tile.ToolBase + c * 5 + t,
      tool: {
        class: cls,
        tier,
        speed: stats.speed,
        harvestLevel: stats.harvestLevel,
        maxDurability: stats.durability,
        damage: baseDamage + TIER_DAMAGE[tier],
      },
    });
  }
}

export function itemDef(id: string): ItemDef | undefined {
  return REGISTRY.get(id);
}

export function allItems(): ItemDef[] {
  return [...REGISTRY.values()];
}

export function registerItem(def: ItemDef): void {
  register(def);
}

/** Create a stack, initializing durability for tools. */
export function makeStack(id: string, count = 1): ItemStack {
  const def = REGISTRY.get(id);
  const stack: ItemStack = { id, count };
  if (def?.tool) stack.durability = def.tool.maxDurability;
  return stack;
}

export function maxStackOf(id: string): number {
  return REGISTRY.get(id)?.maxStack ?? 64;
}

/** Two stacks can merge if same item and neither is a damaged tool. */
export function stacksMatch(a: ItemStack, b: ItemStack): boolean {
  if (a.id !== b.id) return false;
  const def = REGISTRY.get(a.id);
  if (def?.tool) return false; // tools never stack
  return true;
}
