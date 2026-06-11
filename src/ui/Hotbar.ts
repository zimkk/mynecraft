import * as THREE from 'three';
import { Block, blockDef } from '../world/BlockRegistry';
import { tileIconURL } from '../rendering/TextureAtlas';
import { Input } from '../core/Input';

const SLOT_BLOCKS: Block[] = [
  Block.Grass,
  Block.Dirt,
  Block.Stone,
  Block.Cobblestone,
  Block.Plank,
  Block.Log,
  Block.Leaves,
  Block.Glass,
  Block.Sand,
];

/** 9-slot DOM hotbar; slot selection via number keys 1-9 and mouse wheel. */
export class Hotbar {
  selected = 0;
  private readonly slotEls: HTMLElement[] = [];
  private readonly nameEl: HTMLElement;
  private nameTimer = 0;

  constructor(container: HTMLElement, atlas: THREE.CanvasTexture) {
    const bar = document.createElement('div');
    bar.id = 'hotbar';
    for (let i = 0; i < SLOT_BLOCKS.length; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const def = blockDef(SLOT_BLOCKS[i]);
      const img = document.createElement('img');
      img.src = tileIconURL(atlas, def.tiles[3]); // top-face tile as icon
      img.alt = def.name;
      slot.appendChild(img);
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

    this.render();
  }

  get selectedBlock(): Block {
    return SLOT_BLOCKS[this.selected];
  }

  update(dt: number, input: Input): void {
    for (let i = 0; i < 9; i++) {
      if (input.justPressed(`Digit${i + 1}`)) this.select(i);
    }
    const wheel = input.consumeWheel();
    if (wheel !== 0) {
      this.select((this.selected + wheel + SLOT_BLOCKS.length) % SLOT_BLOCKS.length);
    }
    if (this.nameTimer > 0) {
      this.nameTimer -= dt;
      if (this.nameTimer <= 0) this.nameEl.style.opacity = '0';
    }
  }

  select(i: number): void {
    if (i === this.selected) return;
    this.selected = i;
    this.render();
    this.nameEl.textContent = blockDef(this.selectedBlock).name;
    this.nameEl.style.opacity = '1';
    this.nameTimer = 1.2;
  }

  private render(): void {
    this.slotEls.forEach((el, i) => el.classList.toggle('active', i === this.selected));
  }
}
