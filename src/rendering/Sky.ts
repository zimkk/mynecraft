import * as THREE from 'three';

const SKY_RADIUS = 380;
const STAR_COUNT = 700;
const CLOUD_PLANE_SIZE = 720;
const CLOUD_WIND_SPEED = 0.7; // base world units/sec the cloud layers drift

/** One parallax cloud sheet: bigger/closer vs. smaller/higher for depth. */
interface CloudLayerSpec {
  height: number; repeat: number; speed: number; opacity: number; seed: number;
}
const CLOUD_LAYERS: CloudLayerSpec[] = [
  { height: 104, repeat: 5, speed: 1.0, opacity: 0.9, seed: 0 },   // low, large, slow puffs
  { height: 132, repeat: 8, speed: 1.7, opacity: 0.5, seed: 991 }, // high, small, fast wisps
];

/** Soft radial-gradient glow disc — used for the sun (warm) and its halo. */
function glowTexture(core: string, mid: string): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, core);
  grad.addColorStop(0.45, mid);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Pale cratered disc for the moon. */
function moonTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = '#dadadd';
  ctx.fill();
  ctx.fillStyle = '#a9a9ae';
  for (const [cx, cy, r] of [[20, 18, 5], [42, 30, 4], [27, 43, 6], [46, 16, 3]] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Seamless integer-lattice hash in [0,1), periodic over `period` cells so the
 *  generated noise tiles perfectly across the canvas edges. */
function latticeHash(ix: number, iy: number, period: number, seed: number): number {
  ix = ((ix % period) + period) % period;
  iy = ((iy % period) + period) % period;
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

/** Tileable fractal (fBm) value noise in [0,1). Each octave's lattice period
 *  divides the [0,1) UV range, so the result wraps seamlessly. */
function cloudFbm(u: number, v: number, seed: number): number {
  let n = 0, amp = 0.5, period = 4;
  for (let o = 0; o < 4; o++) {
    const x = u * period, y = v * period;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const sx = (() => { const t = x - x0; return t * t * (3 - 2 * t); })();
    const sy = (() => { const t = y - y0; return t * t * (3 - 2 * t); })();
    const a = latticeHash(x0, y0, period, seed) + (latticeHash(x0 + 1, y0, period, seed) - latticeHash(x0, y0, period, seed)) * sx;
    const b = latticeHash(x0, y0 + 1, period, seed) + (latticeHash(x0 + 1, y0 + 1, period, seed) - latticeHash(x0, y0 + 1, period, seed)) * sx;
    n += (a + (b - a) * sy) * amp;
    amp *= 0.5; period *= 2;
  }
  return n;
}

/**
 * Soft, fluffy, seamless cloud sheet baked from tileable fractal noise. Dense
 * cores read brighter than thin edges (fake volume/self-shadow), the coverage
 * is feathered with a smooth threshold so there are no hard pixel edges, and
 * the whole thing wraps cleanly so it can be tiled across the sky plane.
 */
function cloudTexture(seed: number): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const threshold = 0.46;
  const feather = 0.16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const density = cloudFbm(x / size, y / size, seed);
      // Feathered coverage → smooth alpha edges.
      const t = (density - threshold) / feather;
      const cover = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
      // Denser interior is brighter; thin fringes pick up a faint cool grey.
      const lum = 235 + Math.round(20 * Math.min(1, (density - threshold) * 3));
      const grey = 206 + Math.round(24 * cover);
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, lum);
      data[i + 1] = Math.min(255, lum);
      data[i + 2] = Math.min(255, Math.max(lum, grey));
      data[i + 3] = Math.round(cover * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Visible sky furniture the DayNightCycle didn't have: a glowing sun disc and
 * a cratered moon (both billboard sprites riding the same orbit as the sun
 * light, the moon parked opposite it), a star field that fades in at night,
 * and a drifting cloud layer. All textures are procedural canvas, consistent
 * with the rest of the game's zero-external-asset art style.
 */
/** A single drifting cloud sheet plus the metadata its motion needs. */
interface CloudLayer {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  tex: THREE.Texture;
  spec: CloudLayerSpec;
  snap: number;
}

export class Sky {
  private readonly sun: THREE.Sprite;
  private readonly moon: THREE.Sprite;
  private readonly stars: THREE.Points;
  private readonly starMaterial: THREE.PointsMaterial;
  private readonly cloudLayers: CloudLayer[] = [];
  private cloudDrift = 0;

  constructor(scene: THREE.Scene) {
    const sunMat = new THREE.SpriteMaterial({
      map: glowTexture('#fffaf0', 'rgba(255,250,230,0.9)'),
      transparent: true, depthWrite: false, depthTest: false, fog: false,
    });
    this.sun = new THREE.Sprite(sunMat);
    this.sun.scale.set(46, 46, 1);
    this.sun.renderOrder = -10;
    scene.add(this.sun);

    const moonMat = new THREE.SpriteMaterial({
      map: moonTexture(), transparent: true, depthWrite: false, depthTest: false, fog: false,
    });
    this.moon = new THREE.Sprite(moonMat);
    this.moon.scale.set(28, 28, 1);
    this.moon.renderOrder = -10;
    scene.add(this.moon);

    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      // Random point on the upper hemisphere of a sphere shell (stars stay
      // above the horizon band, like the real night sky from ground level).
      const u = Math.random();
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      positions[i * 3] = r * Math.cos(theta) * SKY_RADIUS;
      positions[i * 3 + 1] = u * SKY_RADIUS * 0.95 + 5;
      positions[i * 3 + 2] = r * Math.sin(theta) * SKY_RADIUS;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMaterial = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    this.stars = new THREE.Points(geo, this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -11;
    scene.add(this.stars);

    const cloudGeo = new THREE.PlaneGeometry(CLOUD_PLANE_SIZE, CLOUD_PLANE_SIZE);
    for (const spec of CLOUD_LAYERS) {
      const tex = cloudTexture(spec.seed);
      tex.repeat.set(spec.repeat, spec.repeat);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      });
      const mesh = new THREE.Mesh(cloudGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = -9;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.cloudLayers.push({ mesh, mat, tex, spec, snap: CLOUD_PLANE_SIZE / spec.repeat });
    }
  }

  /** Call once per simulation tick with dt, the player position and the DayNightCycle's sun direction/daylight. */
  update(dt: number, playerPos: THREE.Vector3, sunDir: THREE.Vector3, daylight: number): void {
    this.sun.position.copy(playerPos).addScaledVector(sunDir, SKY_RADIUS);
    this.moon.position.copy(playerPos).addScaledVector(sunDir, -SKY_RADIUS);
    this.stars.position.copy(playerPos);
    // Stars fade in well before full night and are fully gone by mid-morning.
    this.starMaterial.opacity = Math.max(0, 1 - daylight * 1.6);

    // Clouds: each parallax layer is a plane that re-centers under the player
    // (snapped to its own tile size, so the recenter is invisible) while its
    // texture offset scrolls steadily — the classic trick for an infinite,
    // drifting cloud sheet. Two layers at different scales/speeds give depth.
    this.cloudDrift += dt * CLOUD_WIND_SPEED;
    const brightness = 0.4 + 0.6 * daylight; // dusk/dawn warmth handled by fog tint
    for (const layer of this.cloudLayers) {
      const snap = layer.snap;
      layer.mesh.position.set(
        Math.round(playerPos.x / snap) * snap,
        layer.spec.height,
        Math.round(playerPos.z / snap) * snap,
      );
      const off = (this.cloudDrift * layer.spec.speed) / snap;
      layer.tex.offset.set(off, off * 0.35);
      layer.mat.color.setScalar(brightness);
      layer.mat.opacity = layer.spec.opacity * (0.6 + 0.4 * daylight);
    }
  }

  setVisible(v: boolean): void {
    this.sun.visible = v;
    this.moon.visible = v;
    this.stars.visible = v;
    for (const layer of this.cloudLayers) layer.mesh.visible = v;
  }
}
