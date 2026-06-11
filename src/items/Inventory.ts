import { ItemStack, maxStackOf, stacksMatch } from './ItemRegistry';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // slots 0-8 are the hotbar

/**
 * Slot-based inventory. All mutation goes through methods so the UI can
 * subscribe via onChange. Slots hold `ItemStack | null`.
 */
export class Inventory {
  readonly slots: Array<ItemStack | null>;
  /** Subscribers re-render when the contents change. */
  private listeners: Array<() => void> = [];

  constructor(size = INVENTORY_SIZE) {
    this.slots = new Array(size).fill(null);
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  notify(): void {
    for (const fn of this.listeners) fn();
  }

  /**
   * Add a stack: first top up existing matching stacks, then fill empty slots
   * (hotbar slots first). Returns the count that did NOT fit.
   */
  add(stack: ItemStack): number {
    let remaining = stack.count;
    const max = maxStackOf(stack.id);

    // Pass 1: merge into existing stacks.
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && stacksMatch(s, stack) && s.count < max) {
        const take = Math.min(max - s.count, remaining);
        s.count += take;
        remaining -= take;
      }
    }
    // Pass 2: empty slots.
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(max, remaining);
        this.slots[i] = { ...stack, count: take };
        remaining -= take;
      }
    }
    if (remaining !== stack.count) this.notify();
    return remaining;
  }

  canFit(stack: ItemStack): boolean {
    let space = 0;
    const max = maxStackOf(stack.id);
    for (const s of this.slots) {
      if (!s) return true;
      if (stacksMatch(s, stack)) space += max - s.count;
      if (space >= stack.count) return true;
    }
    return space >= stack.count;
  }

  /** Remove up to `count` items from a slot; returns what was removed. */
  removeFrom(slot: number, count: number): ItemStack | null {
    const s = this.slots[slot];
    if (!s) return null;
    const take = Math.min(count, s.count);
    const removed: ItemStack = { ...s, count: take };
    s.count -= take;
    if (s.count <= 0) this.slots[slot] = null;
    this.notify();
    return removed;
  }

  /** Consume one item from a slot (placing blocks, eating). */
  consumeOne(slot: number): void {
    this.removeFrom(slot, 1);
  }

  get(slot: number): ItemStack | null {
    return this.slots[slot] ?? null;
  }

  set(slot: number, stack: ItemStack | null): void {
    this.slots[slot] = stack;
    this.notify();
  }

  swap(a: number, b: number): void {
    [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
    this.notify();
  }

  /** Total count of an item across all slots. */
  countOf(id: string): number {
    let n = 0;
    for (const s of this.slots) if (s?.id === id) n += s.count;
    return n;
  }

  /** Remove `count` of an item from anywhere in the inventory. */
  removeById(id: string, count: number): boolean {
    if (this.countOf(id) < count) return false;
    let remaining = count;
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const s = this.slots[i];
      if (s?.id === id) {
        const take = Math.min(s.count, remaining);
        s.count -= take;
        remaining -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    this.notify();
    return true;
  }

  toJSON(): Array<ItemStack | null> {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  loadFrom(data: Array<ItemStack | null>): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = data[i];
      this.slots[i] = s && typeof s.id === 'string' && s.count > 0 ? { ...s } : null;
    }
    this.notify();
  }
}
