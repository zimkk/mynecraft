import * as THREE from 'three';
import { ChunkManager } from '../world/ChunkManager';
import { isCollidable, Block } from '../world/BlockRegistry';
import { Input } from '../core/Input';

const WIDTH = 0.6;       // AABB footprint (x/z)
const HEIGHT = 1.8;      // AABB height
const EYE_HEIGHT = 1.62; // camera above feet

const GRAVITY = -28;
const JUMP_SPEED = 9.2;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 6.8;
const FLY_SPEED = 11;
const FLY_SPRINT_SPEED = 28;
const MOUSE_SENS = 0.0023;
const DOUBLE_TAP_MS = 280;

/**
 * First-person player: yaw/pitch mouse look, WASD movement relative to yaw,
 * gravity + jumping, and axis-separated AABB collision against the voxel
 * world (resolving X, Y, Z independently makes the player slide along walls
 * instead of sticking).
 */
export class Player {
  readonly position = new THREE.Vector3(); // feet center
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  flying = false;
  onGround = false;
  /** Creative: flight allowed, no damage/hunger. Set from the game mode. */
  creative = false;
  dead = false;

  // Survival stats (20 = 10 hearts / drumsticks).
  health = 20;
  hunger = 20;
  saturation = 5;
  air = 10;
  static readonly MAX_AIR = 10;

  onDamage?: (amount: number) => void;
  onDeath?: () => void;

  private fallDistance = 0;
  private exhaustion = 0;
  private regenTimer = 0;
  private starveTimer = 0;
  private drownTimer = 0;
  private lastSpaceTap = 0;
  private readonly world: ChunkManager;

  constructor(world: ChunkManager) {
    this.world = world;
  }

  get eyePosition(): THREE.Vector3 {
    return this.position.clone().add(new THREE.Vector3(0, EYE_HEIGHT, 0));
  }

  /** Unit vector the camera looks along. */
  get lookDirection(): THREE.Vector3 {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
  }

  /** Apply damage (creative players are invulnerable). */
  damage(amount: number): void {
    if (this.creative || this.dead || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.onDamage?.(amount);
    if (this.health <= 0) {
      this.dead = true;
      this.onDeath?.();
    }
  }

  /** Eat food: restores hunger and saturation. */
  eat(hungerValue: number, saturationValue: number): void {
    this.hunger = Math.min(20, this.hunger + hungerValue);
    this.saturation = Math.min(this.hunger, this.saturation + saturationValue);
  }

  respawn(at: THREE.Vector3): void {
    this.position.copy(at);
    this.velocity.set(0, 0, 0);
    this.health = 20;
    this.hunger = 20;
    this.saturation = 5;
    this.air = Player.MAX_AIR;
    this.fallDistance = 0;
    this.dead = false;
    this.flying = false;
  }

  update(dt: number, input: Input): void {
    if (this.dead) return; // frozen until respawn

    // --- Mouse look ---
    const { dx, dy } = input.consumeMouseDelta();
    this.yaw -= dx * MOUSE_SENS;
    this.pitch -= dy * MOUSE_SENS;
    const maxPitch = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

    // --- Fly toggle (creative only): double-tap space or F ---
    if (this.creative && input.justPressed('Space')) {
      const now = performance.now();
      if (now - this.lastSpaceTap < DOUBLE_TAP_MS) {
        this.flying = !this.flying;
        this.velocity.y = 0;
        this.lastSpaceTap = 0;
      } else {
        this.lastSpaceTap = now;
      }
    }
    if (this.creative && input.justPressed('KeyF')) {
      this.flying = !this.flying;
      this.velocity.y = 0;
    }
    if (!this.creative) this.flying = false;

    // --- Horizontal movement relative to yaw ---
    let mx = 0;
    let mz = 0;
    if (input.isDown('KeyW')) mz -= 1;
    if (input.isDown('KeyS')) mz += 1;
    if (input.isDown('KeyA')) mx -= 1;
    if (input.isDown('KeyD')) mx += 1;
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    const sprint = input.isDown('ControlLeft') || input.isDown('ShiftLeft');
    const speed = this.flying
      ? (sprint ? FLY_SPRINT_SPEED : FLY_SPEED)
      : (sprint ? SPRINT_SPEED : WALK_SPEED);

    // Rotate input by yaw: forward is -Z in camera space.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.velocity.x = (mx * cos - mz * sin) * speed;
    this.velocity.z = (mz * cos + mx * sin) * speed;

    // --- Vertical ---
    if (this.flying) {
      this.velocity.y = 0;
      if (input.isDown('Space')) this.velocity.y = speed;
      if (input.isDown('KeyC')) this.velocity.y = -speed;
    } else {
      this.velocity.y += GRAVITY * dt;
      if (this.velocity.y < -60) this.velocity.y = -60; // terminal velocity
      if (input.isDown('Space') && this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
        this.exhaustion += 0.1;
      }
    }

    // --- Move with collision, one axis at a time ---
    const wasFalling = !this.onGround && this.velocity.y < 0;
    if (wasFalling && !this.flying) this.fallDistance += -this.velocity.y * dt;
    this.onGround = false;
    this.moveAxis(0, this.velocity.x * dt);
    this.moveAxis(1, this.velocity.y * dt);
    this.moveAxis(2, this.velocity.z * dt);

    // --- Fall damage: hits past a 3.5-block grace ---
    if (this.onGround && this.fallDistance > 0) {
      if (!this.flying && this.fallDistance > 3.5) {
        this.damage(Math.round(this.fallDistance - 3));
      }
      this.fallDistance = 0;
    }
    if (this.flying) this.fallDistance = 0;

    this.updateSurvivalStats(dt, sprint && len > 0);

    // Fell out of the world → pop back above ground.
    if (this.position.y < -16) {
      this.position.y = 100;
      this.velocity.set(0, 0, 0);
      this.damage(4);
    }
  }

  /** Hunger, regen, starvation, drowning — survival mode only. */
  private updateSurvivalStats(dt: number, sprinting: boolean): void {
    if (this.creative) {
      this.air = Player.MAX_AIR;
      return;
    }

    // Drowning: eye underwater drains air, then 2 damage per second.
    const eye = this.eyePosition;
    const inWater = this.world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z)) === Block.Water;
    if (inWater) {
      this.air = Math.max(0, this.air - dt);
      if (this.air <= 0) {
        this.drownTimer += dt;
        if (this.drownTimer >= 1) {
          this.drownTimer = 0;
          this.damage(2);
        }
      }
    } else {
      this.air = Math.min(Player.MAX_AIR, this.air + dt * 2);
      this.drownTimer = 0;
    }

    // Hunger: passive trickle + activity costs, buffered through saturation.
    this.exhaustion += dt * (sprinting ? 0.1 : 0.005);
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }

    // Regeneration: nearly full hunger heals over time (and costs hunger).
    if (this.hunger >= 18 && this.health < 20) {
      this.regenTimer += dt;
      if (this.regenTimer >= 2.5) {
        this.regenTimer = 0;
        this.health = Math.min(20, this.health + 1);
        this.exhaustion += 1.5;
      }
    } else {
      this.regenTimer = 0;
    }

    // Starvation: empty hunger chips health down to half a heart.
    if (this.hunger <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 2) {
        this.starveTimer = 0;
        if (this.health > 1) this.damage(1);
      }
    } else {
      this.starveTimer = 0;
    }
  }

  /**
   * Move along one axis and resolve overlap against solid blocks.
   * After moving, every block cell the AABB overlaps is checked; on hit the
   * position is clamped flush to the block face and that velocity axis zeroed.
   */
  private moveAxis(axis: 0 | 1 | 2, amount: number): void {
    if (amount === 0) return;
    const p = this.position;
    const coord = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
    p[coord] += amount;

    const half = WIDTH / 2;
    const minX = Math.floor(p.x - half);
    const maxX = Math.floor(p.x + half - 1e-7);
    const minY = Math.floor(p.y);
    const maxY = Math.floor(p.y + HEIGHT - 1e-7);
    const minZ = Math.floor(p.z - half);
    const maxZ = Math.floor(p.z + half - 1e-7);

    // Scan every overlapped cell and clamp against the MOST restrictive one
    // (clamping to the first found can pick the wrong plane when several
    // cells overlap, e.g. moving up beside a step).
    let hit = false;
    let landed = false;
    let resolved = axis === 0 ? p.x : axis === 1 ? p.y : p.z;

    for (let by = minY; by <= maxY; by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        for (let bx = minX; bx <= maxX; bx++) {
          const id = this.world.getBlock(bx, by, bz);
          if (!isCollidable(id)) continue;
          hit = true;

          let candidate: number;
          if (axis === 0) {
            candidate = amount > 0 ? bx - half - 1e-6 : bx + 1 + half + 1e-6;
          } else if (axis === 1) {
            if (amount > 0) {
              candidate = by - HEIGHT - 1e-6;
            } else {
              candidate = by + 1;
              landed = true;
            }
          } else {
            candidate = amount > 0 ? bz - half - 1e-6 : bz + 1 + half + 1e-6;
          }
          resolved = amount > 0 ? Math.min(resolved, candidate) : Math.max(resolved, candidate);
        }
      }
    }

    if (hit) {
      p[coord] = resolved;
      if (axis === 0) this.velocity.x = 0;
      else if (axis === 2) this.velocity.z = 0;
      else {
        this.velocity.y = 0;
        if (landed) this.onGround = true;
      }
    }
  }

  /** Would a block placed at this cell intersect the player's AABB? */
  intersectsBlock(bx: number, by: number, bz: number): boolean {
    const half = WIDTH / 2;
    const p = this.position;
    return (
      bx + 1 > p.x - half && bx < p.x + half &&
      by + 1 > p.y && by < p.y + HEIGHT &&
      bz + 1 > p.z - half && bz < p.z + half
    );
  }

  applyToCamera(camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.eyePosition);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(this.yaw);
    camera.rotateX(this.pitch);
  }
}
