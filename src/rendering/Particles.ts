import * as THREE from 'three';

const MAX_PARTICLES = 400;
const GRAVITY = -18;

/**
 * Pooled point-sprite particles (block-break debris, eat crumbs). One
 * THREE.Points draws every live particle; dead slots are recycled.
 */
export class Particles {
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly colors = new Float32Array(MAX_PARTICLES * 3);
  private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly geometry: THREE.BufferGeometry;
  private next = 0;

  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.12,
      vertexColors: true,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(this.geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    this.life.fill(0);
    // Park dead particles far underground so they never render visibly.
    for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -1000;
  }

  /** Spray a burst of tinted debris from a point (block break, eating). */
  burst(x: number, y: number, z: number, r: number, g: number, b: number, count = 14): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_PARTICLES;
      this.positions[i * 3] = x + (Math.random() - 0.5) * 0.6;
      this.positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.6;
      this.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
      this.velocities[i * 3] = (Math.random() - 0.5) * 3.5;
      this.velocities[i * 3 + 1] = 1.5 + Math.random() * 3;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 3.5;
      const shade = 0.75 + Math.random() * 0.45;
      this.colors[i * 3] = r * shade;
      this.colors[i * 3 + 1] = g * shade;
      this.colors[i * 3 + 2] = b * shade;
      this.life[i] = 0.5 + Math.random() * 0.35;
    }
  }

  /** Spawn falling rain streaks in a disk above (cx, cz), at height cy. */
  rain(cx: number, cy: number, cz: number, radius: number, count = 24): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      this.positions[i * 3] = cx + Math.cos(a) * r;
      this.positions[i * 3 + 1] = cy;
      this.positions[i * 3 + 2] = cz + Math.sin(a) * r;
      this.velocities[i * 3] = 0;
      this.velocities[i * 3 + 1] = -9 - Math.random() * 3;
      this.velocities[i * 3 + 2] = 0;
      this.colors[i * 3] = 0.6;
      this.colors[i * 3 + 1] = 0.7;
      this.colors[i * 3 + 2] = 0.95;
      this.life[i] = 1.2;
    }
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -1000;
        continue;
      }
      this.velocities[i * 3 + 1] += GRAVITY * dt;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
    }
    if (any) {
      (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
