import * as THREE from 'three';
import { Inventory, HOTBAR_SIZE, INVENTORY_SIZE } from '../items/Inventory';
import { ItemStack, allItems, itemDef, makeStack, maxStackOf, stacksMatch } from '../items/ItemRegistry';
import { matchRecipe } from '../crafting/Recipes';
import { FurnaceState } from '../world/Furnace';
import { ChestState, CHEST_SLOTS } from '../world/Chest';
import { BrewingState } from '../world/Brewing';
import { renderSlotContents, iconURL } from './Hotbar';

export interface InventoryScreenCallbacks {
  /** Throw a stack out into the world (in front of the player). */
  tossItem: (stack: ItemStack) => void;
  /** Creative palette visibility (wired to game mode in Phase 17). */
  isCreative: () => boolean;
  /** Called when the screen wants to close (main re-locks the pointer). */
  requestClose: () => void;
}

// Virtual slot indices: 0..35 inventory, 100..108 craft grid, 200 result,
// 300/301/302 furnace input/fuel/output, 400..426 chest, 500..503 brewing.
const CRAFT_BASE = 100;
const RESULT_SLOT = 200;
const FURNACE_INPUT = 300;
const FURNACE_FUEL = 301;
const FURNACE_OUTPUT = 302;
const CHEST_BASE = 400; // 400..426, 27 slots
const BREW_REAGENT = 500;
const BREW_BOTTLE_BASE = 501; // 501..503, 3 bottle slots

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
  /** Open furnace (UI shows its slots live); null outside furnace mode. */
  private furnaceState: FurnaceState | null = null;
  /** Open chest's 27 slots; null outside chest mode. */
  private chestState: ChestState | null = null;
  /** Open brewing stand's slots; null outside brewing mode. */
  private brewState: BrewingState | null = null;
  private craftRowEl!: HTMLElement;
  private furnaceRowEl!: HTMLElement;
  private chestRowEl!: HTMLElement;
  private brewRowEl!: HTMLElement;
  private playerPreviewEl!: HTMLElement;
  private smeltFillEl!: HTMLElement;
  private flameFillEl!: HTMLElement;
  private brewFillEl!: HTMLElement;
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

    // Crafting area: [player preview] + 3×3 grid + arrow + result. The preview
    // box only shows in the personal-inventory (2×2) mode, like Minecraft.
    const craftRow = document.createElement('div');
    craftRow.className = 'craft-row';
    const preview = document.createElement('div');
    preview.className = 'player-preview';
    preview.innerHTML = '<div class="player-doll"></div>';
    craftRow.appendChild(preview);
    this.playerPreviewEl = preview;
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
    this.craftRowEl = craftRow;

    // Furnace area: input over fuel, flame + progress indicators, output.
    const furnRow = document.createElement('div');
    furnRow.className = 'craft-row furnace-row';
    furnRow.style.display = 'none';
    const ioCol = document.createElement('div');
    ioCol.className = 'furnace-io';
    ioCol.appendChild(this.makeSlot(FURNACE_INPUT));
    const flame = document.createElement('div');
    flame.className = 'furnace-flame';
    this.flameFillEl = document.createElement('div');
    flame.appendChild(this.flameFillEl);
    ioCol.appendChild(flame);
    ioCol.appendChild(this.makeSlot(FURNACE_FUEL));
    furnRow.appendChild(ioCol);
    const smeltBar = document.createElement('div');
    smeltBar.className = 'smelt-bar';
    this.smeltFillEl = document.createElement('div');
    smeltBar.appendChild(this.smeltFillEl);
    furnRow.appendChild(smeltBar);
    furnRow.appendChild(this.makeSlot(FURNACE_OUTPUT));
    panel.appendChild(furnRow);
    this.furnaceRowEl = furnRow;

    // Chest area: 3×9 grid of external slots (separate from the player's own).
    const chestRow = document.createElement('div');
    chestRow.className = 'inv-grid chest-grid';
    chestRow.style.display = 'none';
    for (let i = 0; i < CHEST_SLOTS; i++) {
      chestRow.appendChild(this.makeSlot(CHEST_BASE + i));
    }
    panel.appendChild(chestRow);
    this.chestRowEl = chestRow;

    // Brewing area: reagent slot over a progress bar, three bottle slots.
    const brewRow = document.createElement('div');
    brewRow.className = 'craft-row brewing-row';
    brewRow.style.display = 'none';
    brewRow.appendChild(this.makeSlot(BREW_REAGENT));
    const brewBar = document.createElement('div');
    brewBar.className = 'brew-bar';
    this.brewFillEl = document.createElement('div');
    brewBar.appendChild(this.brewFillEl);
    brewRow.appendChild(brewBar);
    const bottleCol = document.createElement('div');
    bottleCol.className = 'brew-bottles';
    for (let i = 0; i < 3; i++) bottleCol.appendChild(this.makeSlot(BREW_BOTTLE_BASE + i));
    brewRow.appendChild(bottleCol);
    panel.appendChild(brewRow);
    this.brewRowEl = brewRow;

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
    if (index === FURNACE_INPUT) return this.furnaceState?.input ?? null;
    if (index === FURNACE_FUEL) return this.furnaceState?.fuel ?? null;
    if (index === FURNACE_OUTPUT) return this.furnaceState?.output ?? null;
    if (index === BREW_REAGENT) return this.brewState?.reagent ?? null;
    if (index >= BREW_BOTTLE_BASE && index < BREW_BOTTLE_BASE + 3) {
      return this.brewState?.bottles[index - BREW_BOTTLE_BASE] ?? null;
    }
    if (index >= CHEST_BASE) return this.chestState?.[index - CHEST_BASE] ?? null;
    if (index >= CRAFT_BASE) return this.craftSlots[index - CRAFT_BASE];
    return this.inventory.get(index);
  }

  private setSlot(index: number, stack: ItemStack | null): void {
    if (index === RESULT_SLOT) return;
    if (index === FURNACE_INPUT) { if (this.furnaceState) this.furnaceState.input = stack; return; }
    if (index === FURNACE_FUEL) { if (this.furnaceState) this.furnaceState.fuel = stack; return; }
    if (index === FURNACE_OUTPUT) { if (this.furnaceState) this.furnaceState.output = stack; return; }
    if (index === BREW_REAGENT) { if (this.brewState) this.brewState.reagent = stack; return; }
    if (index >= BREW_BOTTLE_BASE && index < BREW_BOTTLE_BASE + 3) {
      if (this.brewState) this.brewState.bottles[index - BREW_BOTTLE_BASE] = stack;
      return;
    }
    if (index >= CHEST_BASE) { if (this.chestState) this.chestState[index - CHEST_BASE] = stack; return; }
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
    // Furnace output: take-only.
    if (index === FURNACE_OUTPUT) {
      const out = this.getSlot(FURNACE_OUTPUT);
      if (!out) return;
      if (shift) {
        const leftover = this.inventory.add(out);
        this.setSlot(FURNACE_OUTPUT, leftover > 0 ? { ...out, count: leftover } : null);
      } else if (!this.cursorStack) {
        this.cursorStack = out;
        this.setSlot(FURNACE_OUTPUT, null);
      } else if (stacksMatch(this.cursorStack, out) &&
                 this.cursorStack.count + out.count <= maxStackOf(out.id)) {
        this.cursorStack.count += out.count;
        this.setSlot(FURNACE_OUTPUT, null);
      }
      this.refresh();
      return;
    }

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
        // Craft grid / furnace / chest → player inventory.
        const leftover = this.inventory.add(slot);
        this.setSlot(index, leftover > 0 ? { ...slot, count: leftover } : null);
      } else if (this.chestState) {
        // Player inventory → open chest.
        const leftover = this.quickMoveIntoChest(slot);
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

  /** Merge a stack into the open chest (matching stacks first, then empties). Returns leftover count. */
  private quickMoveIntoChest(stack: ItemStack): number {
    const chest = this.chestState;
    if (!chest) return stack.count;
    let remaining = stack.count;
    const max = maxStackOf(stack.id);
    for (let i = 0; i < CHEST_SLOTS && remaining > 0; i++) {
      const s = chest[i];
      if (s && stacksMatch(s, stack) && s.count < max) {
        const take = Math.min(max - s.count, remaining);
        s.count += take;
        remaining -= take;
      }
    }
    for (let i = 0; i < CHEST_SLOTS && remaining > 0; i++) {
      if (!chest[i]) {
        const take = Math.min(max, remaining);
        chest[i] = { ...stack, count: take };
        remaining -= take;
      }
    }
    return remaining;
  }

  /** mode 2 = personal 2×2 grid; mode 3 = crafting table 3×3. */
  openScreen(mode: 2 | 3 = 2): void {
    this.open = true;
    this.furnaceState = null;
    this.chestState = null;
    this.brewState = null;
    this.titleEl.textContent = 'Crafting';
    this.craftRowEl.style.display = 'flex';
    this.furnaceRowEl.style.display = 'none';
    this.chestRowEl.style.display = 'none';
    this.brewRowEl.style.display = 'none';
    this.playerPreviewEl.style.display = mode === 2 ? 'flex' : 'none';
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

  /** Open with a live furnace's slots instead of the crafting grid. */
  openFurnace(state: FurnaceState): void {
    this.open = true;
    this.furnaceState = state;
    this.chestState = null;
    this.brewState = null;
    this.titleEl.textContent = 'Furnace';
    this.craftRowEl.style.display = 'none';
    this.furnaceRowEl.style.display = 'flex';
    this.chestRowEl.style.display = 'none';
    this.brewRowEl.style.display = 'none';
    this.root.style.display = 'flex';
    this.refresh();
  }

  /** Open a chest's 27 external slots alongside the player's own inventory. */
  openChest(state: ChestState): void {
    this.open = true;
    this.furnaceState = null;
    this.chestState = state;
    this.brewState = null;
    this.titleEl.textContent = 'Chest';
    this.craftRowEl.style.display = 'none';
    this.furnaceRowEl.style.display = 'none';
    this.chestRowEl.style.display = 'grid';
    this.brewRowEl.style.display = 'none';
    this.root.style.display = 'flex';
    this.refresh();
  }

  /** Open a brewing stand's reagent + 3 bottle slots. */
  openBrewing(state: BrewingState): void {
    this.open = true;
    this.furnaceState = null;
    this.chestState = null;
    this.brewState = state;
    this.titleEl.textContent = 'Brewing Stand';
    this.craftRowEl.style.display = 'none';
    this.furnaceRowEl.style.display = 'none';
    this.chestRowEl.style.display = 'none';
    this.brewRowEl.style.display = 'flex';
    this.root.style.display = 'flex';
    this.refresh();
  }

  /** Live indicator refresh while a furnace is open (called from the render loop). */
  tickFurnaceUI(): void {
    if (this.open && this.furnaceState) {
      const s = this.furnaceState;
      this.smeltFillEl.style.width = `${Math.round(s.progress * 100)}%`;
      this.flameFillEl.style.height = `${s.fuelTotal > 0 ? Math.round((s.fuelLeft / s.fuelTotal) * 100) : 0}%`;
      // Slot contents change as items smelt — re-render the furnace slots only.
      for (const idx of [FURNACE_INPUT, FURNACE_FUEL, FURNACE_OUTPUT]) {
        renderSlotContents(this.slotEls.get(idx)!, this.getSlot(idx), this.atlas);
      }
    }
    if (this.open && this.brewState) {
      const s = this.brewState;
      this.brewFillEl.style.width = `${Math.round(s.progress * 100)}%`;
      for (const idx of [BREW_REAGENT, BREW_BOTTLE_BASE, BREW_BOTTLE_BASE + 1, BREW_BOTTLE_BASE + 2]) {
        renderSlotContents(this.slotEls.get(idx)!, this.getSlot(idx), this.atlas);
      }
    }
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
    // Furnace/chest/brewing contents stay with their block.
    this.furnaceState = null;
    this.chestState = null;
    this.brewState = null;
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
