import { SaveManager } from '../save/SaveManager';

export interface MenuCallbacks {
  resume: () => void;
  setRenderDistance: (chunks: number) => void;
  setSensitivity: (mult: number) => void;
  setVolume: (volume: number) => void;
  exportWorld: () => void;
  /** Toggle survival/creative; returns the new mode label. */
  toggleGameMode: () => string;
}

const SETTINGS_KEY = 'voxelcraft.settings';

export interface Settings {
  renderDistance: number;
  sensitivity: number;
  volume: number;
}

export function loadSettings(): Settings {
  let s: Partial<Settings> = {};
  try {
    s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  } catch { /* corrupted settings → defaults */ }
  const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
  };
  return {
    renderDistance: clamp(s.renderDistance, 3, 12, 6),
    sensitivity: clamp(s.sensitivity, 0.2, 3, 1),
    volume: clamp(s.volume, 0, 1, 0.5),
  };
}

/**
 * Pause / main menu overlay. Shown whenever the pointer is unlocked (Esc).
 * Hosts resume, live settings (render distance, sensitivity, volume), game
 * mode toggle, new world (seed + mode), reset, export/import, controls.
 */
export class Menu {
  private readonly root: HTMLElement;
  private readonly settings: Settings;

  constructor(container: HTMLElement, callbacks: MenuCallbacks, initialMode: string) {
    this.settings = loadSettings();
    const s = this.settings;
    this.root = document.createElement('div');
    this.root.id = 'menu';
    this.root.innerHTML = `
      <div class="panel">
        <h1>Mynecraft</h1>
        <div class="byline">by Hassan Nazir</div>
        <button id="m-resume">▶ Play</button>
        <div class="row">
          <label>Render distance: <span id="m-rd-val">${s.renderDistance}</span> chunks</label>
          <input id="m-rd" type="range" min="3" max="12" step="1" value="${s.renderDistance}">
        </div>
        <div class="row">
          <label>Mouse sensitivity: <span id="m-sens-val">${s.sensitivity.toFixed(1)}</span>×</label>
          <input id="m-sens" type="range" min="0.2" max="3" step="0.1" value="${s.sensitivity}">
        </div>
        <div class="row">
          <label>Volume: <span id="m-vol-val">${Math.round(s.volume * 100)}</span>%</label>
          <input id="m-vol" type="range" min="0" max="1" step="0.05" value="${s.volume}">
        </div>
        <div class="row seed-row">
          <input id="m-seed" type="text" placeholder="seed (blank = random)" maxlength="32">
          <select id="m-new-mode">
            <option value="survival">Survival</option>
            <option value="creative">Creative</option>
          </select>
          <button id="m-new">New World</button>
        </div>
        <div class="row btn-row">
          <button id="m-export">Export</button>
          <button id="m-import">Import</button>
          <button id="m-reset" class="danger">Reset World</button>
        </div>
        <div class="row btn-row">
          <button id="m-mode">Mode: ${initialMode}</button>
        </div>
        <div class="controls">
          <b>Controls</b><br>
          WASD move · mouse look · Space jump · Ctrl/Shift sprint<br>
          LMB break/attack · RMB place/use/eat · E inventory · Q drop<br>
          1–9 / wheel select · F3 debug · Esc menu<br>
          Creative: double-Space or F to fly (Space/C up/down)
        </div>
      </div>`;
    container.appendChild(this.root);

    const $ = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;

    $('m-resume').addEventListener('click', callbacks.resume);
    $('m-mode').addEventListener('click', () => {
      $('m-mode').textContent = `Mode: ${callbacks.toggleGameMode()}`;
    });

    const bindSlider = (
      id: string, valId: string,
      format: (v: number) => string,
      apply: (v: number) => void,
    ) => {
      const el = $(id) as HTMLInputElement;
      el.addEventListener('input', () => {
        const v = Number(el.value);
        $(valId).textContent = format(v);
        apply(v);
        this.persist();
      });
    };
    bindSlider('m-rd', 'm-rd-val', (v) => String(v), (v) => { s.renderDistance = v; callbacks.setRenderDistance(v); });
    bindSlider('m-sens', 'm-sens-val', (v) => v.toFixed(1), (v) => { s.sensitivity = v; callbacks.setSensitivity(v); });
    bindSlider('m-vol', 'm-vol-val', (v) => String(Math.round(v * 100)), (v) => { s.volume = v; callbacks.setVolume(v); });

    $('m-new').addEventListener('click', () => {
      const seedInput = ($('m-seed') as HTMLInputElement).value.trim();
      const seed = seedInput || Math.random().toString(36).slice(2, 10);
      const mode = ($('m-new-mode') as HTMLSelectElement).value === 'creative' ? 'creative' : 'survival';
      SaveManager.newWorld(seed, mode);
    });

    $('m-export').addEventListener('click', callbacks.exportWorld);
    $('m-reset').addEventListener('click', () => {
      if (confirm('Delete this world and start over?')) SaveManager.reset();
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

  private persist(): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  set visible(v: boolean) {
    this.root.style.display = v ? 'flex' : 'none';
  }
}
