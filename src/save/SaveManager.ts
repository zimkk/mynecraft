import { ItemStack } from '../items/ItemRegistry';
import { FurnaceState } from '../world/Furnace';

export const SAVE_VERSION = 4;

export interface SaveData {
  version: number;
  seed: string;
  /** Player-modified blocks: "wx,wy,wz" → block id (delta vs. generated terrain). */
  edits: Array<[string, number]>;
  player: {
    x: number; y: number; z: number;
    yaw: number; pitch: number;
    flying: boolean;
    hotbarSlot: number;
  };
  /** Time of day fraction (0-1). */
  time: number;
  /** v2+: player inventory slots. */
  inventory: Array<ItemStack | null>;
  /** v3+: furnace block-entity states keyed by "x,y,z". */
  furnaces: Array<[string, FurnaceState]>;
  /** v4+: survival stats + game mode. */
  health: number;
  hunger: number;
  gameMode: 'survival' | 'creative';
}

/**
 * Upgrade older saves in place; returns null if the save is unusable.
 * v1 → v2: inventory didn't exist yet — start empty.
 * v2 → v3: furnaces didn't exist yet — start empty.
 */
function migrate(data: SaveData): SaveData | null {
  if (typeof data.seed !== 'string' || !Array.isArray(data.edits)) return null;
  if (data.version === 1) {
    data.inventory = [];
    data.version = 2;
  }
  if (data.version === 2) {
    data.furnaces = [];
    data.version = 3;
  }
  if (data.version === 3) {
    data.health = 20;
    data.hunger = 20;
    data.gameMode = 'survival';
    data.version = 4;
  }
  if (data.version !== SAVE_VERSION) return null;
  return data;
}

const SAVE_KEY = 'voxelcraft.save.v1';
const NEW_SEED_KEY = 'voxelcraft.newseed';
const NEW_MODE_KEY = 'voxelcraft.newmode';
const AUTOSAVE_INTERVAL_S = 15;

/**
 * Persists the world as seed + edit-delta to localStorage (tiny even for big
 * worlds), with JSON file export/import. "New world" and "reset" work by
 * staging the change and reloading the page — startup then picks it up.
 */
export class SaveManager {
  private readonly getState: () => SaveData;
  private timer = 0;

  constructor(getState: () => SaveData) {
    this.getState = getState;
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.save();
    });
  }

  /** Call every frame; saves on a fixed wall-clock interval. */
  tick(dt: number): void {
    this.timer += dt;
    if (this.timer >= AUTOSAVE_INTERVAL_S) {
      this.timer = 0;
      this.save();
    }
  }

  save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.getState()));
    } catch (e) {
      console.warn('Save failed:', e);
    }
  }

  static load(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return migrate(JSON.parse(raw) as SaveData);
    } catch {
      return null;
    }
  }

  /** Seed staged by "New World" before the page reloaded, if any. */
  static consumeNewSeed(): string | null {
    const seed = localStorage.getItem(NEW_SEED_KEY);
    if (seed !== null) localStorage.removeItem(NEW_SEED_KEY);
    return seed;
  }

  /** Game mode staged alongside a new seed. */
  static consumeNewMode(): 'survival' | 'creative' {
    const mode = localStorage.getItem(NEW_MODE_KEY);
    localStorage.removeItem(NEW_MODE_KEY);
    return mode === 'creative' ? 'creative' : 'survival';
  }

  /** Stage a fresh world with the given seed + mode and reload. */
  static newWorld(seed: string, mode: 'survival' | 'creative' = 'survival'): void {
    localStorage.removeItem(SAVE_KEY);
    localStorage.setItem(NEW_SEED_KEY, seed);
    localStorage.setItem(NEW_MODE_KEY, mode);
    location.reload();
  }

  /** Wipe the save and reload (same as new world with a random seed). */
  static reset(): void {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(NEW_SEED_KEY);
    location.reload();
  }

  /** Download the current state as a JSON file. */
  exportToFile(): void {
    const blob = new Blob([JSON.stringify(this.getState(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `voxelcraft-world-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Validate an imported JSON file, store it as the active save, reload. */
  static async importFromFile(file: File): Promise<void> {
    const text = await file.text();
    const data = migrate(JSON.parse(text) as SaveData);
    if (!data) throw new Error('Not a valid VoxelCraft save file');
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    location.reload();
  }
}
