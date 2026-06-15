/**
 * Procedural pixel-art sprites for the HUD (hearts, hunger drumsticks, air
 * bubbles) and the inventory player preview, generated on a canvas the same
 * way the block atlas is. Returned as data URLs; CSS scales them up with
 * `image-rendering: pixelated` for the crisp Minecraft look. No external
 * assets — keeps the game self-contained.
 */

type ColorFn = (x: number, y: number) => string | null;

function render(w: number, h: number, fn: ColorFn): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = fn(x, y);
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return c.toDataURL();
}

// 9×9 heart silhouette (classic two-hump shape, point at the bottom).
const HEART_MASK = [
  '.XX..XX..',
  'XXXX.XXXX',
  'XXXXXXXXX',
  'XXXXXXXXX',
  '.XXXXXXX.',
  '..XXXXX..',
  '...XXX...',
  '....X....',
  '.........',
];

// 9×9 drumstick: meat lump (M) tapering into a bone (B).
const HUNGER_MASK = [
  '..MMM....',
  '.MMMMM...',
  '.MMMMM...',
  '..MMMMM..',
  '...MMMM..',
  '....MMMM.',
  '.....BBBB',
  '......BB.',
  '.........',
];

const HEART_RED = '#e23d3d';
const HEART_HILITE = '#ff8d8d';
const EMPTY_SLOT = '#4b4b4b';
const MEAT = '#b06b2c';
const MEAT_HI = '#cf8a45';
const BONE = '#f2ead0';

/** Heart in red, with an upper-left highlight pixel. */
function heartColor(x: number, y: number): string | null {
  const on = HEART_MASK[y]?.[x] === 'X';
  if (!on) return null;
  if ((x === 1 && y === 1) || (x === 2 && y === 2)) return HEART_HILITE;
  return HEART_RED;
}

/** Hunger drumstick: meat + bone, with a meat highlight. */
function hungerColor(x: number, y: number): string | null {
  const ch = HUNGER_MASK[y]?.[x];
  if (ch === 'B') return BONE;
  if (ch === 'M') return (x === 2 && y === 1) || (x === 2 && y === 2) ? MEAT_HI : MEAT;
  return null;
}

/** Air bubble: light-blue ring with a white glint. */
function bubbleColor(x: number, y: number): string | null {
  const dx = x - 4;
  const dy = y - 4;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 4.1) return null;
  if (x === 2 && y === 2) return '#ffffff';
  if (d > 2.7) return '#3f8fd8';
  return '#a9dcff';
}

function maskEmpty(mask: string[]): ColorFn {
  return (x, y) => (mask[y]?.[x] && mask[y][x] !== '.' ? EMPTY_SLOT : null);
}

/** Half sprite = colored left half over an empty-container right half. */
function halfSprite(mask: string[], base: ColorFn): ColorFn {
  const empty = maskEmpty(mask);
  return (x, y) => (x <= 4 ? base(x, y) : empty(x, y));
}

export interface HudSpriteSet {
  heartFull: string;
  heartHalf: string;
  heartEmpty: string;
  hungerFull: string;
  hungerHalf: string;
  hungerEmpty: string;
  bubbleFull: string;
  bubbleHalf: string;
  steve: string;
}

export function buildHudSprites(): HudSpriteSet {
  return {
    heartFull: render(9, 9, heartColor),
    heartHalf: render(9, 9, halfSprite(HEART_MASK, heartColor)),
    heartEmpty: render(9, 9, maskEmpty(HEART_MASK)),
    hungerFull: render(9, 9, hungerColor),
    hungerHalf: render(9, 9, halfSprite(HUNGER_MASK, hungerColor)),
    hungerEmpty: render(9, 9, maskEmpty(HUNGER_MASK)),
    bubbleFull: render(9, 9, bubbleColor),
    bubbleHalf: render(9, 9, (x, y) => (x <= 4 ? bubbleColor(x, y) : null)),
    steve: buildSteve(),
  };
}

/**
 * Small front-facing blocky avatar for the survival inventory's player-preview
 * box (16×32, scaled up by CSS). Drawn as colored regions, not per-pixel.
 */
function buildSteve(): string {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  const rect = (col: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  // Head: hair, skin, eyes.
  rect('#3b2a1a', 4, 0, 8, 3);          // hair top
  rect('#b58963', 4, 3, 8, 5);          // face
  rect('#3b2a1a', 4, 3, 1, 5);          // sideburn L
  rect('#3b2a1a', 11, 3, 1, 5);         // sideburn R
  rect('#ffffff', 5, 5, 2, 1); rect('#3a4fa0', 6, 5, 1, 1); // left eye
  rect('#ffffff', 9, 5, 2, 1); rect('#3a4fa0', 9, 5, 1, 1); // right eye
  rect('#8a5a3a', 6, 7, 4, 1);          // mouth/chin shade
  // Body: cyan shirt.
  rect('#2aa1a8', 5, 8, 6, 9);
  rect('#1f7f85', 5, 8, 6, 1);          // collar shade
  // Arms: skin sleeves.
  rect('#2aa1a8', 3, 8, 2, 6);          // left sleeve
  rect('#b58963', 3, 14, 2, 3);         // left hand
  rect('#2aa1a8', 11, 8, 2, 6);         // right sleeve
  rect('#b58963', 11, 14, 2, 3);        // right hand
  // Legs: blue trousers.
  rect('#3a3f8a', 5, 17, 3, 11);
  rect('#33377a', 8, 17, 3, 11);
  rect('#444444', 5, 28, 3, 2);         // shoes
  rect('#444444', 8, 28, 3, 2);
  return c.toDataURL();
}
