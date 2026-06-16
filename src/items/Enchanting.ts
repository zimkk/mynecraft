import { Enchant, EnchantType, ItemStack, ToolClass, itemDef } from './ItemRegistry';

const MAX_LEVEL = 3;
const LEVEL_COST = 2;
const LAPIS_COST = 1;

/** Which enchant types a tool class can receive (mirrors vanilla's "applicable" rules, trimmed). */
function eligibleTypes(toolClass: ToolClass): EnchantType[] {
  if (toolClass === 'sword') return ['sharpness', 'unbreaking'];
  if (toolClass === 'hoe') return ['unbreaking'];
  return ['efficiency', 'unbreaking'];
}

/**
 * Enchant the item in `held` in place. No separate table UI (see PROGRESS.md
 * Phase 23 notes) — right-clicking the enchanting table with a tool/weapon
 * selected spends levels + lapis and rolls one of its eligible enchants,
 * stacking onto an existing one of the same type (capped at level 3).
 * Returns false (no charge taken) if the item isn't enchantable or the
 * player can't afford it.
 */
export function tryEnchant(
  held: ItemStack | null,
  spendLevels: (n: number) => boolean,
  removeLapis: (n: number) => boolean,
): Enchant | null {
  const tool = held ? itemDef(held.id)?.tool : undefined;
  if (!held || !tool) return null;
  if (!spendLevels(LEVEL_COST)) return null;
  if (!removeLapis(LAPIS_COST)) return null;

  const options = eligibleTypes(tool.class);
  const type = options[Math.floor(Math.random() * options.length)];
  const level = held.enchant?.type === type ? Math.min(MAX_LEVEL, held.enchant.level + 1) : 1;
  const enchant: Enchant = { type, level };
  held.enchant = enchant;
  return enchant;
}

/** Mining-speed multiplier from Efficiency (used by BlockInteraction.mineTick). */
export function efficiencyMultiplier(enchant: Enchant | undefined): number {
  return enchant?.type === 'efficiency' ? 1 + enchant.level * 0.3 : 1;
}

/** Bonus melee damage from Sharpness (added to the tool's base damage). */
export function sharpnessBonus(enchant: Enchant | undefined): number {
  return enchant?.type === 'sharpness' ? enchant.level : 0;
}

/** Unbreaking gives a chance to skip a durability hit on use. */
export function unbreakingSavesDurability(enchant: Enchant | undefined): boolean {
  if (enchant?.type !== 'unbreaking') return false;
  return Math.random() < enchant.level / (enchant.level + 1);
}
