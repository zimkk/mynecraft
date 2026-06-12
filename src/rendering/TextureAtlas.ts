import * as THREE from 'three';
import { Tile } from '../world/BlockRegistry';

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 8;
export const TILE_PX = 16;

/** Deterministic RNG so the generated textures look the same every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RGBA = [number, number, number, number];

/** Per-pixel painter: returns RGBA for pixel (x, y) inside a 16×16 tile. */
type TilePainter = (x: number, y: number, rng: () => number) => RGBA;

/** Base color with subtle per-pixel brightness noise — the classic voxel look. */
function noisy(r: number, g: number, b: number, variance = 18): TilePainter {
  return (_x, _y, rng) => {
    const n = (rng() - 0.5) * 2 * variance;
    return [r + n, g + n, b + n, 255];
  };
}

const PAINTERS: Record<number, TilePainter> = {
  [Tile.GrassTop]: noisy(106, 170, 64),
  [Tile.GrassSide]: (x, y, rng) => {
    // Dirt with a ragged grass strip across the top few pixels.
    const grassDepth = 3 + Math.floor(rng() * 2.5);
    return y < grassDepth ? noisy(106, 170, 64)(x, y, rng) : noisy(134, 96, 67)(x, y, rng);
  },
  [Tile.Dirt]: noisy(134, 96, 67),
  [Tile.Stone]: noisy(127, 127, 127),
  [Tile.Sand]: noisy(219, 207, 163, 12),
  [Tile.Water]: (_x, _y, rng) => {
    const n = (rng() - 0.5) * 16;
    return [50 + n, 100 + n, 200 + n, 165];
  },
  [Tile.LogSide]: (x, _y, rng) => {
    // Vertical bark streaks: darker columns.
    const streak = (x * 7) % 16 < 3 ? -25 : 0;
    const n = (rng() - 0.5) * 16;
    return [102 + streak + n, 81 + streak + n, 50 + streak + n, 255];
  },
  [Tile.LogEnd]: (x, y, rng) => {
    // Concentric rings around the tile center.
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const ring = Math.floor(d) % 3 === 0 ? -28 : 0;
    const n = (rng() - 0.5) * 10;
    return [175 + ring + n, 143 + ring + n, 86 + ring + n, 255];
  },
  [Tile.Leaves]: (_x, _y, rng) => {
    const n = (rng() - 0.5) * 40;
    // Occasional darker "gap" pixels for depth.
    const dark = rng() < 0.12 ? -45 : 0;
    return [58 + n + dark, 125 + n + dark, 40 + n + dark, 255];
  },
  [Tile.Plank]: (_x, y, rng) => {
    // Horizontal board seams every 4 pixels.
    const seam = y % 4 === 0 ? -30 : 0;
    const n = (rng() - 0.5) * 14;
    return [168 + seam + n, 133 + seam + n, 81 + seam + n, 255];
  },
  [Tile.Glass]: (x, y) => {
    const edge = x === 0 || y === 0 || x === TILE_PX - 1 || y === TILE_PX - 1;
    if (edge) return [200, 220, 230, 255];
    // Diagonal glint streak, otherwise mostly clear.
    const glint = (x + y) % 16 === 5 || (x + y) % 16 === 6;
    return glint ? [235, 245, 250, 120] : [220, 235, 240, 35];
  },
  [Tile.Cobblestone]: (x, y, rng) => {
    // Rounded "stones" via a coarse 4×4 cell grid with dark mortar lines.
    const mortar = x % 5 === 0 || y % 5 === 0;
    const n = (rng() - 0.5) * 24;
    const base = mortar ? 90 : 130;
    return [base + n, base + n, base + n, 255];
  },
  [Tile.CoalOre]: ore(40, 40, 40),
  [Tile.IronOre]: ore(216, 175, 147),
  [Tile.GoldOre]: ore(250, 220, 80),
  [Tile.DiamondOre]: ore(95, 225, 220),
  [Tile.CoalItem]: itemBlob(35, 35, 35),
  [Tile.DiamondItem]: itemBlob(95, 225, 220),
  [Tile.Stick]: (x, y) => {
    // Diagonal stick from bottom-left to top-right.
    const onStick = Math.abs(x - (15 - y)) <= 1 && x > 2 && x < 13;
    return onStick ? [137, 103, 57, 255] : [0, 0, 0, 0];
  },
  [Tile.IronIngot]: ingot(225, 220, 215),
  [Tile.GoldIngot]: ingot(250, 215, 70),
  [Tile.CraftingTableTop]: (x, y, rng) => {
    // Plank base with a dark work-grid border.
    const border = x <= 1 || y <= 1 || x >= 14 || y >= 14;
    const cross = x === 7 || x === 8 || y === 7 || y === 8;
    const n = (rng() - 0.5) * 14;
    if (border || cross) return [96 + n, 72 + n, 44 + n, 255];
    return [168 + n, 133 + n, 81 + n, 255];
  },
  [Tile.CraftingTableSide]: (x, y, rng) => {
    // Planks with tool silhouettes hinted as dark patches.
    const patch = (x >= 3 && x <= 6 && y >= 3 && y <= 7) || (x >= 9 && x <= 12 && y >= 4 && y <= 8);
    const n = (rng() - 0.5) * 14;
    const d = patch ? -55 : 0;
    return [168 + n + d, 133 + n + d, 81 + n + d, 255];
  },
  [Tile.FurnaceFront]: (x, y, rng) => {
    // Stone body with a dark mouth opening at the bottom center.
    const mouth = x >= 4 && x <= 11 && y >= 8 && y <= 13;
    const n = (rng() - 0.5) * 20;
    if (mouth) return [30 + n * 0.4, 26 + n * 0.4, 24 + n * 0.4, 255];
    const base = x % 5 === 0 || y % 5 === 0 ? 95 : 125;
    return [base + n, base + n, base + n, 255];
  },
  [Tile.FurnaceSide]: (x, y, rng) => {
    const n = (rng() - 0.5) * 20;
    const base = x % 5 === 0 || y % 5 === 0 ? 95 : 125;
    return [base + n, base + n, base + n, 255];
  },
  [Tile.Torch]: (x, y) => {
    // Vertical stick with a glowing head (used by the mini torch model).
    const onStick = x >= 7 && x <= 8;
    if (!onStick) return [0, 0, 0, 0];
    if (y <= 2) return [255, 235, 120, 255]; // flame
    if (y <= 4) return [220, 140, 50, 255]; // ember
    return [137, 103, 57, 255]; // handle
  },
};

// ---- Tool icons: tiles ToolBase + classIndex*5 + tierIndex ----

export const TOOL_CLASSES = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'] as const;
export const TOOL_TIERS = ['wood', 'stone', 'iron', 'gold', 'diamond'] as const;

const TIER_COLORS: Record<string, [number, number, number]> = {
  wood: [160, 125, 75],
  stone: [135, 135, 135],
  iron: [225, 220, 215],
  gold: [250, 215, 70],
  diamond: [95, 225, 220],
};

const HANDLE: [number, number, number] = [120, 88, 46];

/** Which part of a tool (if any) covers pixel (x,y): handle along the anti-diagonal, head near the top-right. */
function toolPart(cls: string, x: number, y: number): 'head' | 'handle' | null {
  const onDiag = Math.abs(x + y - 15) <= 1;
  switch (cls) {
    case 'pickaxe':
      if (y >= 1 && y <= 2 && x >= 2 && x <= 13) return 'head';
      if ((x <= 3 || x >= 12) && y >= 3 && y <= 5 && (x <= 3 ? x + 1 >= y - 2 : true)) return 'head';
      return onDiag && y >= 4 && y <= 13 ? 'handle' : null;
    case 'axe':
      if (x >= 8 && x <= 13 && y >= 0 && y <= 5 && !(x <= 9 && y >= 4)) return 'head';
      return onDiag && y >= 4 && y <= 13 ? 'handle' : null;
    case 'shovel':
      if (x >= 10 && x <= 14 && y >= 0 && y <= 4 && x + y >= 11 && x + y <= 17) return 'head';
      return onDiag && y >= 5 && y <= 13 ? 'handle' : null;
    case 'sword':
      if (onDiag && y >= 1 && y <= 10) return 'head'; // blade
      if ((x === 4 && y === 10) || (x === 6 && y === 12) || (x === 5 && y === 11 - 1)) return 'head'; // guard
      return onDiag && y >= 11 && y <= 14 ? 'handle' : null;
    case 'hoe':
      if (y >= 1 && y <= 2 && x >= 7 && x <= 13) return 'head';
      if (x >= 12 && x <= 13 && y >= 3 && y <= 4) return 'head';
      return onDiag && y >= 3 && y <= 13 ? 'handle' : null;
  }
  return null;
}

// Crack stages (tiles CrackBase..CrackBase+3): denser dark fissures per stage.
for (let stage = 0; stage < 4; stage++) {
  PAINTERS[Tile.CrackBase + stage] = (x, y) => {
    // Deterministic branching cracks radiating from the tile center.
    const h = (Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 16) & 0xff;
    const dist = Math.abs(x - 8) + Math.abs(y - 8);
    const threshold = 30 + stage * 28 - dist * 4;
    return h < threshold ? [15, 15, 15, 200] : [0, 0, 0, 0];
  };
}

for (let c = 0; c < TOOL_CLASSES.length; c++) {
  for (let t = 0; t < TOOL_TIERS.length; t++) {
    const cls = TOOL_CLASSES[c];
    const color = TIER_COLORS[TOOL_TIERS[t]];
    PAINTERS[Tile.ToolBase + c * 5 + t] = (x, y, rng) => {
      const part = toolPart(cls, x, y);
      if (!part) return [0, 0, 0, 0];
      const [r, g, b] = part === 'head' ? color : HANDLE;
      const n = (rng() - 0.5) * 16;
      return [r + n, g + n, b + n, 255];
    };
  }
}

/** Stone base with embedded ore specks at fixed 2×2 spots. */
function ore(r: number, g: number, b: number): TilePainter {
  const spots = [[3, 4], [9, 2], [12, 10], [5, 11], [10, 13], [13, 5]];
  return (x, y, rng) => {
    for (const [sx, sy] of spots) {
      if (x >= sx && x <= sx + 1 && y >= sy && y <= sy + 1) {
        const n = (rng() - 0.5) * 20;
        return [r + n, g + n, b + n, 255];
      }
    }
    return noisy(127, 127, 127)(x, y, rng);
  };
}

/** Rough rounded lump on a transparent background (item icon). */
function itemBlob(r: number, g: number, b: number): TilePainter {
  return (x, y, rng) => {
    const dx = x - 7.5;
    const dy = y - 8;
    if (dx * dx + dy * dy > 22) return [0, 0, 0, 0];
    const n = (rng() - 0.5) * 30;
    const hi = dx + dy < -4 ? 30 : 0; // top-left highlight
    return [r + n + hi, g + n + hi, b + n + hi, 255];
  };
}

/** Trapezoid ingot shape on transparent background. */
function ingot(r: number, g: number, b: number): TilePainter {
  return (x, y, rng) => {
    const inY = y >= 5 && y <= 11;
    const slope = y - 5; // widens downward
    const inX = x >= 4 - Math.floor(slope / 3) && x <= 11 + Math.floor(slope / 3);
    if (!inY || !inX) return [0, 0, 0, 0];
    const n = (rng() - 0.5) * 18;
    const hi = y <= 6 ? 25 : y >= 11 ? -25 : 0;
    return [r + n + hi, g + n + hi, b + n + hi, 255];
  };
}

/**
 * Paints every tile into one canvas and returns it as a Three.js texture with
 * nearest-neighbor filtering for the crisp pixel-art look.
 */
/** Extract one tile from the atlas canvas as a data URL (used for hotbar icons). */
export function tileIconURL(atlas: THREE.CanvasTexture, tile: number, size = 32): string {
  const src = atlas.image as HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    src,
    (tile % ATLAS_COLS) * TILE_PX, Math.floor(tile / ATLAS_COLS) * TILE_PX, TILE_PX, TILE_PX,
    0, 0, size, size,
  );
  return c.toDataURL();
}

export function buildAtlasTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE_PX;
  canvas.height = ATLAS_ROWS * TILE_PX;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(canvas.width, canvas.height);

  for (const [tileStr, paint] of Object.entries(PAINTERS)) {
    const tile = Number(tileStr);
    const ox = (tile % ATLAS_COLS) * TILE_PX;
    const oy = Math.floor(tile / ATLAS_COLS) * TILE_PX;
    const rng = mulberry32(1337 + tile * 101);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const [r, g, b, a] = paint(x, y, rng);
        const i = ((oy + y) * canvas.width + (ox + x)) * 4;
        img.data[i] = Math.max(0, Math.min(255, r));
        img.data[i + 1] = Math.max(0, Math.min(255, g));
        img.data[i + 2] = Math.max(0, Math.min(255, b));
        img.data[i + 3] = Math.max(0, Math.min(255, a));
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
