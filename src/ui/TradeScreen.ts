import * as THREE from 'three';
import { Inventory } from '../items/Inventory';
import { EntityManager } from '../entities/EntityManager';
import { Mob } from '../entities/Mob';
import { Trade } from '../entities/Trading';
import { itemDef, makeStack } from '../items/ItemRegistry';
import { iconURL } from './Hotbar';

/**
 * Villager trade modal: right-click a villager to open it, click "Trade" on
 * any affordable offer to exchange instantly (no drag-and-drop — trades are
 * fixed item-for-item swaps, unlike the general inventory screen).
 */
export class TradeScreen {
  open = false;
  private mob: Mob | null = null;
  private readonly root: HTMLElement;
  private readonly listEl: HTMLElement;

  constructor(
    container: HTMLElement,
    private readonly atlas: THREE.CanvasTexture,
    private readonly inventory: Inventory,
    private readonly entities: EntityManager,
    private readonly requestClose: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'trade-screen';
    this.root.style.display = 'none';

    const panel = document.createElement('div');
    panel.className = 'inv-panel trade-panel';
    const title = document.createElement('div');
    title.className = 'inv-title';
    title.textContent = 'Villager';
    panel.appendChild(title);

    this.listEl = document.createElement('div');
    this.listEl.className = 'trade-list';
    panel.appendChild(this.listEl);

    const hint = document.createElement('div');
    hint.className = 'trade-hint';
    hint.textContent = 'Esc to leave';
    panel.appendChild(hint);

    this.root.appendChild(panel);
    container.appendChild(this.root);

    inventory.onChange(() => {
      if (this.open) this.render();
    });

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        this.requestClose();
      }
    });
  }

  show(mob: Mob): void {
    this.mob = mob;
    this.open = true;
    this.root.style.display = 'flex';
    this.render();
  }

  close(): void {
    this.open = false;
    this.mob = null;
    this.root.style.display = 'none';
  }

  private render(): void {
    this.listEl.innerHTML = '';
    if (!this.mob?.trades) return;
    for (const trade of this.mob.trades) {
      this.listEl.appendChild(this.buildRow(trade));
    }
  }

  private buildRow(trade: Trade): HTMLElement {
    const wantDef = itemDef(trade.wantId);
    const giveDef = itemDef(trade.giveId);

    const row = document.createElement('div');
    row.className = 'trade-row';

    const wantImg = document.createElement('img');
    wantImg.src = iconURL(this.atlas, wantDef?.icon ?? 0);
    const wantLabel = document.createElement('span');
    wantLabel.textContent = `${trade.wantCount} ${wantDef?.name ?? trade.wantId}`;

    const arrow = document.createElement('span');
    arrow.className = 'trade-arrow';
    arrow.textContent = '→';

    const giveImg = document.createElement('img');
    giveImg.src = iconURL(this.atlas, giveDef?.icon ?? 0);
    const giveLabel = document.createElement('span');
    giveLabel.textContent = `${trade.giveCount} ${giveDef?.name ?? trade.giveId}`;

    const btn = document.createElement('button');
    btn.textContent = 'Trade';
    btn.disabled = this.inventory.countOf(trade.wantId) < trade.wantCount;
    btn.onclick = () => this.execute(trade);

    row.append(wantImg, wantLabel, arrow, giveImg, giveLabel, btn);
    return row;
  }

  private execute(trade: Trade): void {
    if (this.inventory.countOf(trade.wantId) < trade.wantCount) return;
    this.inventory.removeById(trade.wantId, trade.wantCount);
    const leftover = this.inventory.add(makeStack(trade.giveId, trade.giveCount));
    if (leftover > 0 && this.mob) {
      this.entities.dropItem(makeStack(trade.giveId, leftover), this.mob.position.clone());
    }
    this.render();
  }
}
