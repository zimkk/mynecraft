import * as THREE from 'three';
import { Inventory, HOTBAR_SIZE, INVENTORY_SIZE } from '../items/Inventory';
import { ItemStack, allItems, itemDef, makeStack, maxStackOf, stacksMatch } from '../items/ItemRegistry';
import { renderSlotContents, iconURL } from './Hotbar';

export interface InventoryScreenCallbacks {
  /** Throw a stack out into the world (in front of the player). */
  tossItem: (stack: ItemStack) => void;
  /** Creative palette visibility (wired to game mode in Phase 17). */
  isCreative: () => boolean;
  /** Called when the screen wants to close (main re-locks the pointer). */
  requestClose: () => void;
}

/**
 * Inventory screen (toggle E): 27 main slots + hotbar row, Minecraft-style
 * cursor-stack interaction — click to pick up / place / swap, right-click to
 * split or place one, shift-click to quick-move between sections — plus a
 * creative palette tab with infinite items.
 */
export class InventoryScreen {
  open = false;
  private cursorStack: ItemStack | null = null;
  private readonly root: HTMLElement;
  private readonly cursorEl: HTMLElement;
  private readonly slotEls: HTMLElement[] = [];
  private readonly paletteEl: HTMLElement;
  private readonly paletteTabEl: HTMLElement;
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

    const title = document.createElement('div');
    title.className = 'inv-title';
    title.textContent = 'Inventory';
    panel.appendChild(title);

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
    el.className = 'slot';
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.onSlotClick(index, e.button, e.shiftKey);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.slotEls[index] = el;
    return el;
  }

  /** Minecraft-style slot interaction state machine. */
  private onSlotClick(index: number, button: number, shift: boolean): void {
    const inv = this.inventory;
    const slot = inv.get(index);

    if (shift && button === 0) {
      // Quick-move between hotbar and main section.
      if (!slot) return;
      const targetStart = index < HOTBAR_SIZE ? HOTBAR_SIZE : 0;
      const targetEnd = index < HOTBAR_SIZE ? INVENTORY_SIZE : HOTBAR_SIZE;
      this.quickMove(index, targetStart, targetEnd);
      return;
    }

    if (button === 0) {
      // Left: pick up / place all / swap / merge.
      if (!this.cursorStack) {
        if (slot) {
          this.cursorStack = slot;
          inv.set(index, null);
        }
      } else if (!slot) {
        inv.set(index, this.cursorStack);
        this.cursorStack = null;
      } else if (stacksMatch(slot, this.cursorStack)) {
        const max = maxStackOf(slot.id);
        const take = Math.min(max - slot.count, this.cursorStack.count);
        slot.count += take;
        this.cursorStack.count -= take;
        if (this.cursorStack.count <= 0) this.cursorStack = null;
        inv.notify();
      } else {
        const tmp = this.cursorStack;
        this.cursorStack = slot;
        inv.set(index, tmp);
      }
    } else if (button === 2) {
      // Right: split half (empty cursor) or place one (holding).
      if (!this.cursorStack) {
        if (slot) {
          const half = Math.ceil(slot.count / 2);
          this.cursorStack = { ...slot, count: half };
          slot.count -= half;
          if (slot.count <= 0) inv.set(index, null);
          else inv.notify();
        }
      } else if (!slot) {
        inv.set(index, { ...this.cursorStack, count: 1 });
        this.cursorStack.count--;
        if (this.cursorStack.count <= 0) this.cursorStack = null;
      } else if (stacksMatch(slot, this.cursorStack) && slot.count < maxStackOf(slot.id)) {
        slot.count++;
        this.cursorStack.count--;
        if (this.cursorStack.count <= 0) this.cursorStack = null;
        inv.notify();
      }
    }
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

  openScreen(): void {
    this.open = true;
    this.root.style.display = 'flex';
    this.refresh();
  }

  closeScreen(): void {
    this.open = false;
    this.root.style.display = 'none';
    // Whatever is on the cursor goes back to the inventory (overflow tossed).
    if (this.cursorStack) {
      const leftover = this.inventory.add(this.cursorStack);
      if (leftover > 0) this.callbacks.tossItem({ ...this.cursorStack, count: leftover });
      this.cursorStack = null;
    }
    this.cursorEl.innerHTML = '';
  }

  refresh(): void {
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      renderSlotContents(this.slotEls[i], this.inventory.get(i), this.atlas);
    }
    // Cursor stack rendering.
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
