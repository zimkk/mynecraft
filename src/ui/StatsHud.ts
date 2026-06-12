import { Player } from '../player/Player';

/**
 * Survival HUD above the hotbar: hearts, drumsticks, and air bubbles while
 * underwater. Hidden entirely in creative mode. Also owns the red damage
 * flash and the death screen.
 */
export class StatsHud {
  private readonly root: HTMLElement;
  private readonly heartEls: HTMLElement[] = [];
  private readonly foodEls: HTMLElement[] = [];
  private readonly airRow: HTMLElement;
  private readonly airEls: HTMLElement[] = [];
  private readonly flashEl: HTMLElement;
  private readonly deathEl: HTMLElement;
  private flashTimer = 0;

  constructor(container: HTMLElement, onRespawn: () => void) {
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
      h.textContent = '❤'; // ❤
      heartRow.appendChild(h);
      this.heartEls.push(h);

      const f = document.createElement('span');
      f.textContent = '\u{1F357}'; // 🍗
      foodRow.appendChild(f);
      this.foodEls.push(f);

      const a = document.createElement('span');
      a.textContent = '●'; // ●
      this.airRow.appendChild(a);
      this.airEls.push(a);
    }

    const top = document.createElement('div');
    top.className = 'stat-top';
    top.appendChild(heartRow);
    top.appendChild(foodRow);
    this.root.appendChild(this.airRow);
    this.root.appendChild(top);
    container.appendChild(this.root);

    this.flashEl = document.createElement('div');
    this.flashEl.id = 'damage-flash';
    container.appendChild(this.flashEl);

    this.deathEl = document.createElement('div');
    this.deathEl.id = 'death-screen';
    this.deathEl.style.display = 'none';
    this.deathEl.innerHTML = '<div class="death-panel"><h1>You died!</h1><button id="respawn-btn">Respawn</button></div>';
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
    if (player.creative) return;

    for (let i = 0; i < 10; i++) {
      const hp = player.health - i * 2;
      this.heartEls[i].className = hp >= 2 ? 'full' : hp >= 1 ? 'half' : 'empty';
      const fd = player.hunger - i * 2;
      this.foodEls[i].className = fd >= 2 ? 'full' : fd >= 1 ? 'half' : 'empty';
      const ar = player.air - i;
      this.airEls[i].className = ar >= 1 ? 'full' : ar > 0 ? 'half' : 'empty';
    }
    this.airRow.style.display = player.air < Player.MAX_AIR ? 'flex' : 'none';
  }
}
