import { ItemStack, itemDef, makeStack, stacksMatch, maxStackOf } from '../items/ItemRegistry';

/** Seconds to smelt one item. */
export const SMELT_TIME = 5;

/** input item id → output item id. */
const SMELT_RECIPES: Record<string, string> = {
  iron_ore: 'iron_ingot',
  gold_ore: 'gold_ingot',
  sand: 'glass',
  cobblestone: 'stone',
  log: 'coal', // charcoal, simplified to coal
  raw_porkchop: 'cooked_porkchop',
};

/** fuel item id → burn seconds. */
const FUEL_VALUES: Record<string, number> = {
  coal: 8 * SMELT_TIME,
  log: 1.5 * SMELT_TIME,
  plank: 1.5 * SMELT_TIME,
  stick: 0.5 * SMELT_TIME,
};

export function smeltResult(id: string): string | undefined {
  return SMELT_RECIPES[id];
}

export function fuelValue(id: string): number {
  return FUEL_VALUES[id] ?? 0;
}

export interface FurnaceState {
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  /** 0..1 progress on the current item. */
  progress: number;
  /** Seconds of burn left on the current fuel piece. */
  fuelLeft: number;
  /** Total seconds the current fuel piece provides (for the flame indicator). */
  fuelTotal: number;
}

function emptyState(): FurnaceState {
  return { input: null, fuel: null, output: null, progress: 0, fuelLeft: 0, fuelTotal: 0 };
}

/**
 * All placed furnaces, keyed by world position. Ticked on wall-clock time
 * from the render loop so smelting continues while the UI is open or the
 * player wanders off.
 */
export class FurnaceManager {
  readonly furnaces = new Map<string, FurnaceState>();

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  getOrCreate(x: number, y: number, z: number): FurnaceState {
    const key = FurnaceManager.key(x, y, z);
    let state = this.furnaces.get(key);
    if (!state) {
      state = emptyState();
      this.furnaces.set(key, state);
    }
    return state;
  }

  /** Remove a broken furnace and return its contents for spilling. */
  remove(x: number, y: number, z: number): ItemStack[] {
    const key = FurnaceManager.key(x, y, z);
    const state = this.furnaces.get(key);
    this.furnaces.delete(key);
    if (!state) return [];
    return [state.input, state.fuel, state.output].filter((s): s is ItemStack => s !== null);
  }

  tick(dt: number): void {
    for (const state of this.furnaces.values()) {
      this.tickOne(state, dt);
    }
  }

  private tickOne(s: FurnaceState, dt: number): void {
    const resultId = s.input ? smeltResult(s.input.id) : undefined;
    // Output must be empty or match the result with room to grow.
    const outputOk =
      resultId !== undefined &&
      (!s.output || (s.output.id === resultId && s.output.count < maxStackOf(resultId)));

    if (!outputOk) {
      // Nothing smeltable: progress decays, fuel keeps burning down if lit.
      s.progress = Math.max(0, s.progress - dt * 2 * (1 / SMELT_TIME));
      s.fuelLeft = Math.max(0, s.fuelLeft - dt);
      return;
    }

    // Light a new piece of fuel if needed.
    if (s.fuelLeft <= 0) {
      const burn = s.fuel ? fuelValue(s.fuel.id) : 0;
      if (burn > 0 && s.fuel) {
        s.fuel.count--;
        if (s.fuel.count <= 0) s.fuel = null;
        s.fuelLeft = burn;
        s.fuelTotal = burn;
      } else {
        // No fuel: progress decays.
        s.progress = Math.max(0, s.progress - dt * 2 * (1 / SMELT_TIME));
        return;
      }
    }

    s.fuelLeft -= dt;
    s.progress += dt / SMELT_TIME;
    if (s.progress >= 1) {
      s.progress = 0;
      const result = makeStack(resultId, 1);
      if (s.output && stacksMatch(s.output, result)) s.output.count++;
      else s.output = result;
      s.input!.count--;
      if (s.input!.count <= 0) s.input = null;
    }
  }

  get isAnyLit(): boolean {
    for (const s of this.furnaces.values()) if (s.fuelLeft > 0) return true;
    return false;
  }

  toJSON(): Array<[string, FurnaceState]> {
    return [...this.furnaces.entries()];
  }

  loadFrom(data: Array<[string, FurnaceState]>): void {
    this.furnaces.clear();
    for (const [key, state] of data) {
      // Sanity: drop stacks whose items no longer exist.
      const clean = (s: ItemStack | null) => (s && itemDef(s.id) ? s : null);
      this.furnaces.set(key, {
        input: clean(state.input),
        fuel: clean(state.fuel),
        output: clean(state.output),
        progress: state.progress ?? 0,
        fuelLeft: state.fuelLeft ?? 0,
        fuelTotal: state.fuelTotal ?? 0,
      });
    }
  }
}
