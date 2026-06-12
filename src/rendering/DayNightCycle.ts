import * as THREE from 'three';
import { CHUNK_SIZE } from '../world/Chunk';

const DAY_LENGTH_S = 300; // full day-night cycle in seconds

const DAY_SKY = new THREE.Color(0x87ceeb);
const NIGHT_SKY = new THREE.Color(0x070b22);
const DUSK_SKY = new THREE.Color(0xe8804a);

/**
 * Drives a smooth day/night cycle: the sun light orbits overhead, sky + fog
 * color blend between day, dusk, and night, and ambient light dims at night.
 * Fog distances track render distance so chunk pop-in is hidden by the haze.
 */
export class DayNightCycle {
  /** Time of day as a fraction: 0 = midnight, 0.25 = sunrise, 0.5 = noon. */
  time = 0.35;
  paused = false;
  private readonly sun: THREE.DirectionalLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly scene: THREE.Scene;
  private readonly fog: THREE.Fog;
  private readonly skyColor = new THREE.Color();

  constructor(scene: THREE.Scene, sun: THREE.DirectionalLight, ambient: THREE.AmbientLight) {
    this.scene = scene;
    this.sun = sun;
    this.ambient = ambient;
    this.fog = new THREE.Fog(DAY_SKY.clone(), 50, 150);
    scene.fog = this.fog;
  }

  update(dt: number, playerPos: THREE.Vector3, renderDistanceChunks: number): void {
    if (!this.paused) {
      this.time = (this.time + dt / DAY_LENGTH_S) % 1;
    }

    // Sun elevation: -1 (midnight) … +1 (noon).
    const angle = (this.time - 0.25) * Math.PI * 2;
    const elevation = Math.sin(angle);

    // Sun orbits in the X/Y plane with a slight Z tilt. DirectionalLight
    // shines from its position toward its target, so park it relative to the
    // player at the orbit direction.
    const dir = new THREE.Vector3(Math.cos(angle), elevation, 0.35).normalize();
    this.sun.position.copy(playerPos).addScaledVector(dir, 200);
    this.sun.target.position.copy(playerPos);
    this.sun.target.updateMatrixWorld();

    // Daylight: 0 at night, 1 in full day, smooth ramp through twilight.
    const daylight = THREE.MathUtils.smoothstep(elevation, -0.12, 0.25);
    // Dusk tint peaks when the sun crosses the horizon.
    const duskiness = Math.max(0, 1 - Math.abs(elevation) / 0.3) * daylight;

    this.sun.intensity = 1.8 * daylight;
    this.ambient.intensity = 0.12 + 0.5 * daylight;

    this.skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, daylight).lerp(DUSK_SKY, duskiness * 0.55);
    (this.scene.background as THREE.Color).copy(this.skyColor);
    this.fog.color.copy(this.skyColor);

    // Fog band sits in the outer third of the render distance.
    const viewBlocks = renderDistanceChunks * CHUNK_SIZE;
    this.fog.near = viewBlocks * 0.55;
    this.fog.far = viewBlocks * 0.98;
  }

  /** True while the sun is up (used by mob spawning/burning). */
  get isDay(): boolean {
    return Math.sin((this.time - 0.25) * Math.PI * 2) > 0.05;
  }

  /** Human-readable clock for the debug overlay, e.g. "13:30". */
  get clock(): string {
    const h = Math.floor(this.time * 24);
    const m = Math.floor((this.time * 24 - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
