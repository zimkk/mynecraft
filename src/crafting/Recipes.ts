import { ItemStack } from '../items/ItemRegistry';

export interface RecipeResult {
  id: string;
  count: number;
}

interface ShapedRecipe {
  type: 'shaped';
  /** Trimmed pattern rows, e.g. ['XXX', ' S ', ' S ']; ' ' = empty. */
  pattern: string[];
  key: Record<string, string>;
  result: RecipeResult;
}

interface ShapelessRecipe {
  type: 'shapeless';
  ingredients: string[];
  result: RecipeResult;
}

type Recipe = ShapedRecipe | ShapelessRecipe;

const RECIPES: Recipe[] = [];

function shaped(pattern: string[], key: Record<string, string>, id: string, count = 1): void {
  RECIPES.push({ type: 'shaped', pattern, key, result: { id, count } });
}

function shapeless(ingredients: string[], id: string, count = 1): void {
  RECIPES.push({ type: 'shapeless', ingredients, result: { id, count } });
}

// ---- Core recipes ----
shapeless(['log'], 'plank', 4);
shaped(['P', 'P'], { P: 'plank' }, 'stick', 4);
shaped(['PP', 'PP'], { P: 'plank' }, 'crafting_table');
shaped(['CCC', 'C C', 'CCC'], { C: 'cobblestone' }, 'furnace');
shaped(['C', 'S'], { C: 'coal', S: 'stick' }, 'torch', 4);
shaped(['PPP', 'P P', 'PPP'], { P: 'plank' }, 'chest');
shaped(['R', 'S'], { R: 'redstone', S: 'stick' }, 'redstone_torch');
shaped(['S', 'C'], { S: 'stick', C: 'cobblestone' }, 'lever');
shapeless(['stone'], 'button');
// Redstone Lamp: real vanilla shape — a Glowstone center in a plus of 4
// Redstone Dust (corners empty). Fixed from an earlier glass-ring placeholder
// now that Glowstone exists (added in the Nether phase).
shaped([' R ', 'RGR', ' R '], { R: 'redstone', G: 'glowstone' }, 'redstone_lamp');
shapeless(['plank', 'plank', 'plank'], 'book');
// Enchanting Table: real vanilla shape — Book on top, a Diamond centered in
// the middle row flanked by Obsidian, Obsidian across the bottom row. Fixed
// a missing-Diamond bug in the original placeholder recipe.
shaped([' B ', 'ODO', 'OOO'], { B: 'book', O: 'obsidian', D: 'diamond' }, 'enchanting_table');
// Brewing: stand (stick stands in for the Nether-exclusive blaze rod, like
// the redstone-torch/lever recipes substituting available materials), bottles
// from glass, and a water bottle straight from a bottle (no fill-from-water
// interaction yet — actual potions only come from brewing, not crafting).
shaped([' S ', 'CCC'], { S: 'stick', C: 'cobblestone' }, 'brewing_stand');
// Glass Bottle: real vanilla shape — a "V" of 3 glass (two top corners, one
// bottom-middle), not just any 3 glass anywhere. Fixed from a shapeless
// placeholder that ignored the shape entirely.
shaped(['G G', ' G '], { G: 'glass' }, 'glass_bottle', 3);
shapeless(['glass_bottle'], 'potion_water');
// Flint and Steel: cobblestone substitutes for the Nether-exclusive flint,
// following the same "available material" pattern as the brewing stand recipe.
shaped(['I', 'C'], { I: 'iron_ingot', C: 'cobblestone' }, 'flint_and_steel');
// End Portal Frame and Eye of Ender are both craftable from ordinary overworld
// materials — a deliberate simplification of vanilla's stronghold/eye-of-ender
// search, matching the project's "substitute available material" pattern.
// Players build their own End portal exactly like a Nether portal.
shapeless(['obsidian', 'diamond'], 'end_portal_frame');
shapeless(['diamond', 'emerald'], 'ender_eye');

// Tools: heads of X over stick handles.
const TOOL_MATERIALS: Array<[string, string]> = [
  ['wooden', 'plank'],
  ['stone', 'cobblestone'],
  ['iron', 'iron_ingot'],
  ['golden', 'gold_ingot'],
  ['diamond', 'diamond'],
];
for (const [tier, mat] of TOOL_MATERIALS) {
  const key = { X: mat, S: 'stick' };
  shaped(['XXX', ' S ', ' S '], key, `${tier}_pickaxe`);
  shaped(['XX', 'XS', ' S'], key, `${tier}_axe`);
  shaped(['X', 'S', 'S'], key, `${tier}_shovel`);
  shaped(['X', 'X', 'S'], key, `${tier}_sword`);
  shaped(['XX', ' S', ' S'], key, `${tier}_hoe`);
}

/** Trim a 2D grid of item ids to its bounding box; null grid → []. */
function trimGrid(ids: Array<string | null>, width: number): string[][] {
  const height = ids.length / width;
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ids[y * width + x]) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) return [];
  const out: string[][] = [];
  for (let y = minY; y <= maxY; y++) {
    const row: string[] = [];
    for (let x = minX; x <= maxX; x++) {
      row.push(ids[y * width + x] ?? '');
    }
    out.push(row);
  }
  return out;
}

function matchesShaped(recipe: ShapedRecipe, grid: string[][]): boolean {
  if (grid.length !== recipe.pattern.length) return false;
  for (let y = 0; y < grid.length; y++) {
    const patternRow = recipe.pattern[y];
    if (grid[y].length !== patternRow.length) return false;
    for (let x = 0; x < patternRow.length; x++) {
      const symbol = patternRow[x];
      const expected = symbol === ' ' ? '' : recipe.key[symbol] ?? '';
      if (grid[y][x] !== expected) return false;
    }
  }
  return true;
}

function matchesShapeless(recipe: ShapelessRecipe, present: string[]): boolean {
  if (present.length !== recipe.ingredients.length) return false;
  const pool = [...recipe.ingredients];
  for (const id of present) {
    const i = pool.indexOf(id);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

/**
 * Find the recipe output for a crafting grid (row-major, `width` columns).
 * Shaped recipes match after both pattern and grid are trimmed to their
 * bounding boxes (so a 2×2 sub-pattern works anywhere in a 3×3 grid).
 */
export function matchRecipe(slots: Array<ItemStack | null>, width: number): RecipeResult | null {
  const ids = slots.map((s) => s?.id ?? null);
  const trimmed = trimGrid(ids, width);
  if (trimmed.length === 0) return null;
  const present = ids.filter((id): id is string => id !== null);

  for (const recipe of RECIPES) {
    if (recipe.type === 'shaped') {
      if (matchesShaped(recipe, trimmed)) return recipe.result;
    } else {
      if (matchesShapeless(recipe, present)) return recipe.result;
    }
  }
  return null;
}
