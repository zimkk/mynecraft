import * as THREE from 'three';
import { ItemStack, itemDef } from '../items/ItemRegistry';
import { Inventory, HOTBAR_SIZE } from '../items/Inventory';
import { tileIconURL } from '../rendering/TextureAtlas';
import { Input } from '../core/Input';

const iconCache = new Map<number, string>();

export function iconURL(atlas: THREE.CanvasTexture, tile: number): string {
  let url = iconCache.get(tile);
  if (!url) {
    url = tileIconURL(atlas, tile);
    iconCache.set(tile, url);
  }
  return url;
}

/** Renders one inventory slot's contents into a DOM element (shared with the inventory screen). */
export function renderSlotContents(el: HTMLElement, stack: ItemStack | null, atlas: THREE.CanvasTexture): void {
  el.querySelectorAll('img, .count, .dura').forEach((n) => n.remove());
  if (!stack) return;
  const def = itemDef(stack.id);
  if (!def) return;

  const img = document.createElement('img');
  img.src = iconURL(atlas, def.icon);
  img.alt = def.name;
  img.draggable = false;
  el.appendChild(img);

  if (stack.count > 1) {
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(stack.count);
    el.appendChild(count);
  }
  if (def.tool && stack.durability !== undefined && stack.durability < def.tool.maxDurability) {
    const bar = document.createElement('div');
    bar.className = 'dura';
    const fill = document.createElement('div');
    const frac = stack.durability / def.tool.maxDurability;
    fill.style.width = `${Math.round(frac * 100)}%`;
    fill.style.background = frac > 0.5 ? '#6ecf3a' : frac > 0.2 ? '#d8c331' : '#d84331';
    bar.appendChild(fill);
    el.appendChild(bar);
  }
}

/**
 * 9-slot hotbar bound to inventory slots 0-8. Selection via number keys 1-9
 * and the mouse wheel; re-renders whenever the inventory changes.
 */
export class Hotbar {
  selected = 0;
  private readonly slotEls: HTMLElement[] = [];
  private readonly nameEl: HTMLElement;
  private nameTimer = 0;
  private readonly inventory: Inventory;
  private readonly atlas: THREE.CanvasTexture;

  constructor(container: HTMLElement, atlas: THREE.CanvasTexture, inventory: Inventory) {
    this.inventory = inventory;
    this.atlas = atlas;

    const bar = document.createElement('div');
    bar.id = 'hotbar';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i + 1);
      slot.appendChild(num);
      bar.appendChild(slot);
      this.slotEls.push(slot);
    }
    container.appendChild(bar);

    this.nameEl = document.createElement('div');
    this.nameEl.id = 'block-name';
    container.appendChild(this.nameEl);

    inventory.onChange(() => this.render());
    this.render();
  }

  get selectedStack(): ItemStack | null {
    return this.inventory.get(this.selected);
  }

  update(dt: number, input: Input): void {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (input.justPressed(`Digit${i + 1}`)) this.select(i);
    }
    const wheel = input.consumeWheel();
    if (wheel !== 0) {
      this.select((this.selected + wheel + HOTBAR_SIZE) % HOTBAR_SIZE);
    }
    if (this.nameTimer > 0) {
      this.nameTimer -= dt;
      if (this.nameTimer <= 0) this.nameEl.style.opacity = '0';
    }
  }

  select(i: number): void {
    this.selected = i;
    this.render();
    const stack = this.selectedStack;
    if (stack) {
      this.nameEl.textContent = itemDef(stack.id)?.name ?? stack.id;
      this.nameEl.style.opacity = '1';
      this.nameTimer = 1.2;
    } else {
      this.nameEl.style.opacity = '0';
    }
  }

  render(): void {
    this.slotEls.forEach((el, i) => {
      el.classList.toggle('active', i === this.selected);
      renderSlotContents(el, this.inventory.get(i), this.atlas);
    });
  }
}
