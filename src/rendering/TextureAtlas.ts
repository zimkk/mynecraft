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
};

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
