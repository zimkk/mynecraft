import { SaveManager } from '../save/SaveManager';

export interface MenuCallbacks {
  resume: () => void;
  setRenderDistance: (chunks: number) => void;
  exportWorld: () => void;
}

const SETTINGS_KEY = 'voxelcraft.settings';

export function loadRenderDistance(): number {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    const rd = Number(s.renderDistance);
    return rd >= 3 && rd <= 12 ? rd : 6;
  } catch {
    return 6;
  }
}

/**
 * Pause / main menu overlay. Shown whenever the pointer is unlocked (Esc).
 * Hosts resume, live render-distance setting, new world (seed), reset,
 * export/import, and the controls list.
 */
export class Menu {
  private readonly root: HTMLElement;
  private readonly rdLabel: HTMLElement;

  constructor(container: HTMLElement, callbacks: MenuCallbacks, renderDistance: number) {
    this.root = document.createElement('div');
    this.root.id = 'menu';
    this.root.innerHTML = `
      <div class="panel">
        <h1>VoxelCraft</h1>
        <button id="m-resume">▶ Play</button>
        <div class="row">
          <label>Render distance: <span id="m-rd-val">${renderDistance}</span> chunks</label>
          <input id="m-rd" type="range" min="3" max="12" step="1" value="${renderDistance}">
        </div>
        <div class="row seed-row">
          <input id="m-seed" type="text" placeholder="seed (blank = random)" maxlength="32">
          <button id="m-new">New World</button>
        </div>
        <div class="row btn-row">
          <button id="m-export">Export</button>
          <button id="m-import">Import</button>
          <button id="m-reset" class="danger">Reset World</button>
        </div>
        <div class="controls">
          <b>Controls</b><br>
          WASD move · mouse look · Space jump<br>
          double-Space or F toggle fly (Space/C up/down)<br>
          Ctrl/Shift sprint · LMB break · RMB place<br>
          1–9 / wheel select block · F3 debug · Esc menu
        </div>
      </div>`;
    container.appendChild(this.root);

    const $ = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;
    this.rdLabel = $('m-rd-val');

    $('m-resume').addEventListener('click', callbacks.resume);
    $('m-export').addEventListener('click', callbacks.exportWorld);
    $('m-reset').addEventListener('click', () => {
      if (confirm('Delete this world and start over?')) SaveManager.reset();
    });

    const rd = $('m-rd') as HTMLInputElement;
    rd.addEventListener('input', () => {
      const v = Number(rd.value);
      this.rdLabel.textContent = String(v);
      this.saveSettings(v);
      callbacks.setRenderDistance(v);
    });

    $('m-new').addEventListener('click', () => {
      const seedInput = ($('m-seed') as HTMLInputElement).value.trim();
      const seed = seedInput || Math.random().toString(36).slice(2, 10);
      SaveManager.newWorld(seed);
    });

    $('m-import').addEventListener('click', () => {
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = '.json,application/json';
      file.onchange = async () => {
        if (!file.files?.[0]) return;
        try {
          await SaveManager.importFromFile(file.files[0]);
        } catch (e) {
          alert(`Import failed: ${e instanceof Error ? e.message : e}`);
        }
      };
      file.click();
    });
  }

  private saveSettings(renderDistance: number): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ renderDistance }));
  }

  set visible(v: boolean) {
    this.root.style.display = v ? 'flex' : 'none';
  }
}
