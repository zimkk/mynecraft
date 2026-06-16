import { Player } from '../player/Player';
import { buildHudSprites } from './hudSprites';

/**
 * Survival HUD above the hotbar (Minecraft layout): a row of hearts on the
 * left and hunger drumsticks on the right, with air bubbles above the hunger
 * row while underwater. Icons are procedural pixel sprites exposed to CSS as
 * custom properties. Hidden in creative mode. Also owns the damage flash and
 * the death screen.
 */
export class StatsHud {
  private readonly root: HTMLElement;
  private readonly heartEls: HTMLElement[] = [];
  private readonly foodEls: HTMLElement[] = [];
  private readonly airRow: HTMLElement;
  private readonly airEls: HTMLElement[] = [];
  private readonly flashEl: HTMLElement;
  private readonly deathEl: HTMLElement;
  private readonly xpBarFill: HTMLElement;
  private readonly xpLevelEl: HTMLElement;
  private flashTimer = 0;

  constructor(container: HTMLElement, onRespawn: () => void) {
    // Publish the generated sprites as CSS variables so styling stays in CSS.
    const s = buildHudSprites();
    const root = document.documentElement.style;
    root.setProperty('--spr-heart-full', `url(${s.heartFull})`);
    root.setProperty('--spr-heart-half', `url(${s.heartHalf})`);
    root.setProperty('--spr-heart-empty', `url(${s.heartEmpty})`);
    root.setProperty('--spr-hunger-full', `url(${s.hungerFull})`);
    root.setProperty('--spr-hunger-half', `url(${s.hungerHalf})`);
    root.setProperty('--spr-hunger-empty', `url(${s.hungerEmpty})`);
    root.setProperty('--spr-bubble-full', `url(${s.bubbleFull})`);
    root.setProperty('--spr-bubble-half', `url(${s.bubbleHalf})`);
    root.setProperty('--spr-steve', `url(${s.steve})`);

    this.root = document.createElement('div');
    this.root.id = 'stats-hud';

    const heartRow = document.createElement('div');
    heartRow.className = 'stat-row hearts';
    const foodRow = document.createElement('div');
    foodRow.className = 'stat-row food';
    this.airRow = document.createElement('div');
    this.airRow.className = 'stat-row air';

    for (let i = 0; i < 10; i++) {
      const h = document.createElement('span');
      h.className = 'icon heart';
      heartRow.appendChild(h);
      this.heartEls.push(h);

      const f = document.createElement('span');
      f.className = 'icon food';
      foodRow.appendChild(f);
      this.foodEls.push(f);

      const a = document.createElement('span');
      a.className = 'icon air';
      this.airRow.appendChild(a);
      this.airEls.push(a);
    }

    this.root.appendChild(this.airRow);
    const top = document.createElement('div');
    top.className = 'stat-top';
    top.appendChild(heartRow);
    top.appendChild(foodRow);
    this.root.appendChild(top);
    container.appendChild(this.root);

    const xpBar = document.createElement('div');
    xpBar.id = 'xp-bar';
    this.xpBarFill = document.createElement('div');
    this.xpBarFill.id = 'xp-bar-fill';
    xpBar.appendChild(this.xpBarFill);
    this.xpLevelEl = document.createElement('div');
    this.xpLevelEl.id = 'xp-level';
    container.appendChild(xpBar);
    container.appendChild(this.xpLevelEl);

    this.flashEl = document.createElement('div');
    this.flashEl.id = 'damage-flash';
    container.appendChild(this.flashEl);

    this.deathEl = document.createElement('div');
    this.deathEl.id = 'death-screen';
    this.deathEl.style.display = 'none';
    this.deathEl.innerHTML = '<div class="death-panel"><h1>You Died!</h1><button id="respawn-btn">Respawn</button></div>';
    container.appendChild(this.deathEl);
    this.deathEl.querySelector('#respawn-btn')!.addEventListener('click', onRespawn);
  }

  flash(): void {
    this.flashTimer = 0.35;
  }

  showDeath(show: boolean): void {
    this.deathEl.style.display = show ? 'flex' : 'none';
  }

  update(dt: number, player: Player): void {
    this.root.style.display = player.creative ? 'none' : 'block';

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.flashEl.style.opacity = String(Math.max(0, this.flashTimer / 0.35) * 0.45);
    } else {
      this.flashEl.style.opacity = '0';
    }
    const need = Player.xpToNextLevel(player.level);
    this.xpBarFill.style.width = `${Math.min(100, (player.xp / need) * 100)}%`;
    this.xpLevelEl.textContent = player.level > 0 ? String(player.level) : '';
    this.xpLevelEl.style.display = player.level > 0 ? 'block' : 'none';

    if (player.creative) return;

    for (let i = 0; i < 10; i++) {
      const hp = player.health - i * 2;
      this.heartEls[i].className = `icon heart ${hp >= 2 ? 'full' : hp >= 1 ? 'half' : 'empty'}`;
      const fd = player.hunger - i * 2;
      this.foodEls[i].className = `icon food ${fd >= 2 ? 'full' : fd >= 1 ? 'half' : 'empty'}`;
      const ar = player.air - i;
      this.airEls[i].className = `icon air ${ar >= 1 ? 'full' : ar > 0 ? 'half' : 'empty'}`;
    }
    this.airRow.style.display = player.air < Player.MAX_AIR ? 'flex' : 'none';
  }
}
