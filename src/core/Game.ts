import * as THREE from 'three';

/**
 * Core game shell: owns the renderer, scene, camera, and the main loop.
 * Uses a fixed-timestep update (for physics determinism) with a variable
 * render rate driven by requestAnimationFrame.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  /** Fixed update step in seconds (50 ms = 20 ticks/s like Minecraft physics-ish, but we use 60Hz). */
  static readonly FIXED_DT = 1 / 60;
  private static readonly MAX_FRAME_TIME = 0.25; // clamp to avoid spiral of death after tab-out

  private accumulator = 0;
  private lastTime = 0;
  private running = false;

  // FPS tracking
  private frameCount = 0;
  private fpsTimer = 0;
  fps = 0;

  private updateFns: Array<(dt: number) => void> = [];
  private renderFns: Array<(alpha: number, dt: number) => void> = [];

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, 2, 5);

    window.addEventListener('resize', this.onResize);
  }

  /** Register a fixed-timestep update callback (physics, game logic). */
  onUpdate(fn: (dt: number) => void): void {
    this.updateFns.push(fn);
  }

  /** Register a per-frame render callback (interpolation, HUD). */
  onRender(fn: (alpha: number, dt: number) => void): void {
    this.renderFns.push(fn);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);

    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameTime > Game.MAX_FRAME_TIME) frameTime = Game.MAX_FRAME_TIME;

    this.accumulator += frameTime;
    while (this.accumulator >= Game.FIXED_DT) {
      for (const fn of this.updateFns) fn(Game.FIXED_DT);
      this.accumulator -= Game.FIXED_DT;
    }

    const alpha = this.accumulator / Game.FIXED_DT;
    for (const fn of this.renderFns) fn(alpha, frameTime);
    this.renderer.render(this.scene, this.camera);

    // FPS: count frames over 0.5s windows
    this.frameCount++;
    this.fpsTimer += frameTime;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frameCount / this.fpsTimer);
      this.frameCount = 0;
      this.fpsTimer = 0;
    }
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
