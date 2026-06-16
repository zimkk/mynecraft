import * as THREE from 'three';

const SKY_RADIUS = 380;
const STAR_COUNT = 700;

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

/**
 * Visible sky furniture the DayNightCycle didn't have: a glowing sun disc and
 * a cratered moon (both billboard sprites riding the same orbit as the sun
 * light, the moon parked opposite it), plus a star field that fades in at
 * night. All textures are procedural canvas, consistent with the rest of the
 * game's zero-external-asset art style.
 */
export class Sky {
  private readonly sun: THREE.Sprite;
  private readonly moon: THREE.Sprite;
  private readonly stars: THREE.Points;
  private readonly starMaterial: THREE.PointsMaterial;

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
  }

  /** Call once per simulation tick with the player position and the DayNightCycle's sun direction/daylight. */
  update(playerPos: THREE.Vector3, sunDir: THREE.Vector3, daylight: number): void {
    this.sun.position.copy(playerPos).addScaledVector(sunDir, SKY_RADIUS);
    this.moon.position.copy(playerPos).addScaledVector(sunDir, -SKY_RADIUS);
    this.stars.position.copy(playerPos);
    // Stars fade in well before full night and are fully gone by mid-morning.
    this.starMaterial.opacity = Math.max(0, 1 - daylight * 1.6);
  }

  setVisible(v: boolean): void {
    this.sun.visible = v;
    this.moon.visible = v;
    this.stars.visible = v;
  }
}
