import { ItemStack, itemDef } from '../items/ItemRegistry';

export const CHEST_SLOTS = 27;

export type ChestState = Array<ItemStack | null>;

function emptyState(): ChestState {
  return new Array(CHEST_SLOTS).fill(null);
}

/**
 * All placed chests, keyed by world position. Contents persist as long as
 * the block exists; breaking a chest spills everything as item drops.
 */
export class ChestManager {
  readonly chests = new Map<string, ChestState>();

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  getOrCreate(x: number, y: number, z: number): ChestState {
    const key = ChestManager.key(x, y, z);
    let state = this.chests.get(key);
    if (!state) {
      state = emptyState();
      this.chests.set(key, state);
    }
    return state;
  }

  /** Remove a broken chest and return its contents for spilling. */
  remove(x: number, y: number, z: number): ItemStack[] {
    const key = ChestManager.key(x, y, z);
    const state = this.chests.get(key);
    this.chests.delete(key);
    if (!state) return [];
    return state.filter((s): s is ItemStack => s !== null);
  }

  toJSON(): Array<[string, ChestState]> {
    return [...this.chests.entries()];
  }

  loadFrom(data: Array<[string, ChestState]>): void {
    this.chests.clear();
    for (const [key, slots] of data) {
      const clean = emptyState();
      for (let i = 0; i < CHEST_SLOTS; i++) {
        const s = slots[i];
        clean[i] = s && itemDef(s.id) && s.count > 0 ? { ...s } : null;
      }
      this.chests.set(key, clean);
    }
  }
}
