import * as THREE from 'three';
import { Inventory, HOTBAR_SIZE, INVENTORY_SIZE } from '../items/Inventory';
import { ItemStack, allItems, itemDef, makeStack, maxStackOf, stacksMatch } from '../items/ItemRegistry';
import { matchRecipe } from '../crafting/Recipes';
import { renderSlotContents, iconURL } from './Hotbar';

export interface InventoryScreenCallbacks {
  /** Throw a stack out into the world (in front of the player). */
  tossItem: (stack: ItemStack) => void;
  /** Creative palette visibility (wired to game mode in Phase 17). */
  isCreative: () => boolean;
  /** Called when the screen wants to close (main re-locks the pointer). */
  requestClose: () => void;
}

// Virtual slot indices: 0..35 inventory, 100..108 craft grid, 200 result.
const CRAFT_BASE = 100;
const RESULT_SLOT = 200;

/**
 * Inventory screen (toggle E): crafting grid (2×2 standalone, 3×3 at a
 * crafting table) + 27 main slots + hotbar row. Minecraft-style cursor-stack
 * interaction; creative palette tab with infinite items.
 */
export class InventoryScreen {
  open = false;
  private cursorStack: ItemStack | null = null;
  /** Always 3×3 storage; in 2×2 mode the outer cells are hidden (and empty). */
  private readonly craftSlots: Array<ItemStack | null> = new Array(9).fill(null);
  private readonly root: HTMLElement;
  private readonly cursorEl: HTMLElement;
  private readonly slotEls = new Map<number, HTMLElement>();
  private readonly paletteEl: HTMLElement;
  private readonly paletteTabEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly inventory: Inventory;
  private readonly atlas: THREE.CanvasTexture;
  private readonly callbacks: InventoryScreenCallbacks;
  private paletteVisible = false;

  constructor(container: HTMLElement, atlas: THREE.CanvasTexture, inventory: Inventory, callbacks: InventoryScreenCallbacks) {
    this.inventory = inventory;
    this.atlas = atlas;
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.id = 'inv-screen';
    this.root.style.display = 'none';

    const panel = document.createElement('div');
    panel.className = 'inv-panel';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'inv-title';
    this.titleEl.textContent = 'Inventory';
    panel.appendChild(this.titleEl);

    // Crafting area: 3×3 grid + arrow + result.
    const craftRow = document.createElement('div');
    craftRow.className = 'craft-row';
    const craftGrid = document.createElement('div');
    craftGrid.className = 'craft-grid';
    for (let i = 0; i < 9; i++) {
      craftGrid.appendChild(this.makeSlot(CRAFT_BASE + i));
    }
    craftRow.appendChild(craftGrid);
    const arrow = document.createElement('div');
    arrow.className = 'craft-arrow';
    arrow.textContent = '→';
    craftRow.appendChild(arrow);
    craftRow.appendChild(this.makeSlot(RESULT_SLOT));
    panel.appendChild(craftRow);

    // Main 3×9 grid: inventory indices 9..35.
    const mainGrid = document.createElement('div');
    mainGrid.className = 'inv-grid';
    for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) {
      mainGrid.appendChild(this.makeSlot(i));
    }
    panel.appendChild(mainGrid);

    // Hotbar row: indices 0..8.
    const hotbarGrid = document.createElement('div');
    hotbarGrid.className = 'inv-grid inv-hotbar-row';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      hotbarGrid.appendChild(this.makeSlot(i));
    }
    panel.appendChild(hotbarGrid);

    // Creative palette (tab + scrollable item list).
    this.paletteTabEl = document.createElement('button');
    this.paletteTabEl.className = 'inv-tab';
    this.paletteTabEl.textContent = 'Creative Items ▸';
    this.paletteTabEl.addEventListener('click', () => {
      this.paletteVisible = !this.paletteVisible;
      this.refreshPalette();
    });
    panel.appendChild(this.paletteTabEl);

    this.paletteEl = document.createElement('div');
    this.paletteEl.className = 'inv-palette';
    panel.appendChild(this.paletteEl);

    this.root.appendChild(panel);
    container.appendChild(this.root);

    // Click on the dark backdrop (outside the panel) tosses the cursor stack.
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root && this.cursorStack) {
        this.callbacks.tossItem(this.cursorStack);
        this.cursorStack = null;
        this.refresh();
      }
    });

    // Floating cursor stack follows the mouse.
    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'inv-cursor';
    container.appendChild(this.cursorEl);
    window.addEventListener('mousemove', (e) => {
      this.cursorEl.style.left = `${e.clientX + 4}px`;
      this.cursorEl.style.top = `${e.clientY + 4}px`;
    });

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'KeyE' || e.code === 'Escape') {
        e.preventDefault();
        this.callbacks.requestClose();
      }
    });

    inventory.onChange(() => {
      if (this.open) this.refresh();
    });
  }

  private makeSlot(index: number): HTMLElement {
    const el = document.createElement('div');
    el.className = index === RESULT_SLOT ? 'slot result-slot' : 'slot';
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.onSlotClick(index, e.button, e.shiftKey);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.slotEls.set(index, el);
    return el;
  }

  // ---- Virtual slot access (inventory / craft grid / result) ----

  private getSlot(index: number): ItemStack | null {
    if (index === RESULT_SLOT) {
      const r = matchRecipe(this.craftSlots, 3);
      return r ? makeStack(r.id, r.count) : null;
    }
    if (index >= CRAFT_BASE) return this.craftSlots[index - CRAFT_BASE];
    return this.inventory.get(index);
  }

  private setSlot(index: number, stack: ItemStack | null): void {
    if (index === RESULT_SLOT) return;
    if (index >= CRAFT_BASE) this.craftSlots[index - CRAFT_BASE] = stack;
    else this.inventory.set(index, stack);
  }

  /** Take one crafting result: consume one item from each occupied grid cell. */
  private consumeCraftIngredients(): void {
    for (let i = 0; i < 9; i++) {
      const s = this.craftSlots[i];
      if (s) {
        s.count--;
        if (s.count <= 0) this.craftSlots[i] = null;
      }
    }
  }

  /** Minecraft-style slot interaction state machine. */
  private onSlotClick(index: number, button: number, shift: boolean): void {
    // Result slot: take crafted output.
    if (index === RESULT_SLOT) {
      const result = this.getSlot(RESULT_SLOT);
      if (!result) return;
      if (shift) {
        // Craft repeatedly into the inventory until ingredients run out.
        let guard = 64;
        while (guard-- > 0) {
          const r = this.getSlot(RESULT_SLOT);
          if (!r || !this.inventory.canFit(r)) break;
          this.inventory.add(r);
          this.consumeCraftIngredients();
        }
      } else if (!this.cursorStack) {
        this.cursorStack = result;
        this.consumeCraftIngredients();
      } else if (stacksMatch(this.cursorStack, result) &&
                 this.cursorStack.count + result.count <= maxStackOf(result.id)) {
        this.cursorStack.count += result.count;
        this.consumeCraftIngredients();
      }
      this.refresh();
      return;
    }

    const slot = this.getSlot(index);

    if (shift && button === 0) {
      if (!slot) return;
      if (index >= CRAFT_BASE) {
        // Craft grid → inventory.
        const leftover = this.inventory.add(slot);
        this.setSlot(index, leftover > 0 ? { ...slot, count: leftover } : null);
      } else {
        // Quick-move between hotbar and main section.
        const targetStart = index < HOTBAR_SIZE ? HOTBAR_SIZE : 0;
        const targetEnd = index < HOTBAR_SIZE ? INVENTORY_SIZE : HOTBAR_SIZE;
        this.quickMove(index, targetStart, targetEnd);
      }
      this.refresh();
      return;
    }

    if (button === 0) {
      if (!this.cursorStack) {
        if (slot) {
          this.cursorStack = slot;
          this.setSlot(index, null);
        }
      } else if (!slot) {
        this.setSlot(index, this.cursorStack);
        this.cursorStack = null;
      } else if (stacksMatch(slot, this.cursorStack)) {
        const max = maxStackOf(slot.id);
        const take = Math.min(max - slot.count, this.cursorStack.count);
        slot.count += take;
        this.cursorStack.count -= take;
        if (this.cursorStack.count <= 0) this.cursorStack = null;
      } else {
        const tmp = this.cursorStack;
        this.cursorStack = slot;
        this.setSlot(index, tmp);
      }
    } else if (button === 2) {
      if (!this.cursorStack) {
        if (slot) {
          const half = Math.ceil(slot.count / 2);
          this.cursorStack = { ...slot, count: half };
          slot.count -= half;
          if (slot.count <= 0) this.setSlot(index, null);
        }
      } else if (!slot) {
        this.setSlot(index, { ...this.cursorStack, count: 1 });
        this.cursorStack.count--;
        if (this.cursorStack.count <= 0) this.cursorStack = null;
      } else if (stacksMatch(slot, this.cursorStack) && slot.count < maxStackOf(slot.id)) {
        slot.count++;
        this.cursorStack.count--;
        if (this.cursorStack.count <= 0) this.cursorStack = null;
      }
    }
    this.inventory.notify();
    this.refresh();
  }

  /** Move a slot's stack into [start,end), stacking first then empty slots. */
  private quickMove(from: number, start: number, end: number): void {
    const inv = this.inventory;
    const stack = inv.get(from);
    if (!stack) return;
    const max = maxStackOf(stack.id);
    for (let i = start; i < end && stack.count > 0; i++) {
      const s = inv.get(i);
      if (s && stacksMatch(s, stack) && s.count < max) {
        const take = Math.min(max - s.count, stack.count);
        s.count += take;
        stack.count -= take;
      }
    }
    for (let i = start; i < end && stack.count > 0; i++) {
      if (!inv.get(i)) {
        inv.set(i, { ...stack });
        stack.count = 0;
      }
    }
    inv.set(from, stack.count > 0 ? stack : null);
  }

  /** mode 2 = personal 2×2 grid; mode 3 = crafting table 3×3. */
  openScreen(mode: 2 | 3 = 2): void {
    this.open = true;
    this.titleEl.textContent = mode === 3 ? 'Crafting Table' : 'Inventory';
    // Hide the outer craft cells in 2×2 mode (they are empty by invariant).
    for (let i = 0; i < 9; i++) {
      const x = i % 3;
      const y = Math.floor(i / 3);
      const visible = mode === 3 || (x < 2 && y < 2);
      this.slotEls.get(CRAFT_BASE + i)!.style.display = visible ? 'flex' : 'none';
    }
    this.root.style.display = 'flex';
    this.refresh();
  }

  closeScreen(): void {
    this.open = false;
    this.root.style.display = 'none';
    // Cursor stack and craft grid contents go back to the inventory.
    if (this.cursorStack) {
      const leftover = this.inventory.add(this.cursorStack);
      if (leftover > 0) this.callbacks.tossItem({ ...this.cursorStack, count: leftover });
      this.cursorStack = null;
    }
    for (let i = 0; i < 9; i++) {
      const s = this.craftSlots[i];
      if (s) {
        const leftover = this.inventory.add(s);
        if (leftover > 0) this.callbacks.tossItem({ ...s, count: leftover });
        this.craftSlots[i] = null;
      }
    }
    this.cursorEl.innerHTML = '';
  }

  refresh(): void {
    for (const [index, el] of this.slotEls) {
      renderSlotContents(el, this.getSlot(index), this.atlas);
    }
    this.cursorEl.innerHTML = '';
    if (this.cursorStack) {
      const def = itemDef(this.cursorStack.id);
      if (def) {
        const img = document.createElement('img');
        img.src = iconURL(this.atlas, def.icon);
        this.cursorEl.appendChild(img);
        if (this.cursorStack.count > 1) {
          const c = document.createElement('span');
          c.className = 'count';
          c.textContent = String(this.cursorStack.count);
          this.cursorEl.appendChild(c);
        }
      }
    }
    this.refreshPalette();
  }

  private refreshPalette(): void {
    const creative = this.callbacks.isCreative();
    this.paletteTabEl.style.display = creative ? 'block' : 'none';
    this.paletteEl.style.display = creative && this.paletteVisible ? 'grid' : 'none';
    this.paletteTabEl.textContent = this.paletteVisible ? 'Creative Items ▾' : 'Creative Items ▸';
    if (!creative || !this.paletteVisible) return;

    this.paletteEl.innerHTML = '';
    for (const def of allItems()) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.title = def.name;
      renderSlotContents(el, { id: def.id, count: 1 }, this.atlas);
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (e.shiftKey) {
          this.inventory.add(makeStack(def.id, def.maxStack));
        } else if (e.button === 0) {
          this.cursorStack = makeStack(def.id, def.maxStack);
        } else if (e.button === 2) {
          this.cursorStack = makeStack(def.id, 1);
        }
        this.refresh();
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      this.paletteEl.appendChild(el);
    }
  }
}
