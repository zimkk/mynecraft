import { ItemStack, itemDef, makeStack } from '../items/ItemRegistry';

/** Seconds to brew one batch. */
export const BREW_TIME = 8;

/** Reagent item id → potion item id (simplified: no Nether ingredients yet). */
const BREW_RECIPES: Record<string, string> = {
  apple: 'potion_healing',
  coal: 'potion_strength',
  gold_ingot: 'potion_swiftness',
  iron_ingot: 'potion_resistance',
};

export function brewResultFor(reagentId: string): string | undefined {
  return BREW_RECIPES[reagentId];
}

export interface BrewingState {
  reagent: ItemStack | null;
  /** Three bottle slots; potions don't stack (maxStack 1), like vanilla. */
  bottles: [ItemStack | null, ItemStack | null, ItemStack | null];
  /** 0..1 progress on the current batch. */
  progress: number;
}

function emptyState(): BrewingState {
  return { reagent: null, bottles: [null, null, null], progress: 0 };
}

/**
 * Brewing stands, keyed by world position. Mirrors FurnaceManager's pattern:
 * position-keyed state, ticked on wall time so brewing continues with the UI
 * closed. Simplified vs. vanilla — no separate fuel item (blaze powder is
 * Nether-exclusive and the Nether doesn't exist yet, see Phase 26); brewing
 * just takes time once a water bottle and a valid reagent are both present.
 */
export class BrewingManager {
  readonly stands = new Map<string, BrewingState>();

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  getOrCreate(x: number, y: number, z: number): BrewingState {
    const key = BrewingManager.key(x, y, z);
    let state = this.stands.get(key);
    if (!state) {
      state = emptyState();
      this.stands.set(key, state);
    }
    return state;
  }

  /** Remove a broken brewing stand and return its contents for spilling. */
  remove(x: number, y: number, z: number): ItemStack[] {
    const key = BrewingManager.key(x, y, z);
    const state = this.stands.get(key);
    this.stands.delete(key);
    if (!state) return [];
    return [state.reagent, ...state.bottles].filter((s): s is ItemStack => s !== null);
  }

  tick(dt: number): void {
    for (const state of this.stands.values()) this.tickOne(state, dt);
  }

  private tickOne(s: BrewingState, dt: number): void {
    const resultId = s.reagent ? brewResultFor(s.reagent.id) : undefined;
    const hasWaterBottle = s.bottles.some((b) => b?.id === 'potion_water');
    if (!resultId || !hasWaterBottle) {
      s.progress = 0;
      return;
    }

    s.progress += dt / BREW_TIME;
    if (s.progress >= 1) {
      s.progress = 0;
      for (let i = 0; i < 3; i++) {
        if (s.bottles[i]?.id === 'potion_water') s.bottles[i] = makeStack(resultId, 1);
      }
      s.reagent!.count--;
      if (s.reagent!.count <= 0) s.reagent = null;
    }
  }

  toJSON(): Array<[string, BrewingState]> {
    return [...this.stands.entries()];
  }

  loadFrom(data: Array<[string, BrewingState]>): void {
    this.stands.clear();
    for (const [key, state] of data) {
      const clean = (s: ItemStack | null) => (s && itemDef(s.id) ? s : null);
      this.stands.set(key, {
        reagent: clean(state.reagent),
        bottles: [clean(state.bottles[0]), clean(state.bottles[1]), clean(state.bottles[2])],
        progress: state.progress ?? 0,
      });
    }
  }
}
