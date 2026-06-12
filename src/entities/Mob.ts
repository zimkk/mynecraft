import * as THREE from 'three';
import { ChunkManager } from '../world/ChunkManager';
import { isCollidable, Block } from '../world/BlockRegistry';

export type MobTypeId = 'pig' | 'sheep' | 'zombie';

export interface MobTypeDef {
  id: MobTypeId;
  hostile: boolean;
  width: number;
  height: number;
  maxHealth: number;
  walkSpeed: number;
  runSpeed: number;
  drops: Array<{ id: string; min: number; max: number }>;
  attackDamage?: number;
}

export const MOB_TYPES: Record<MobTypeId, MobTypeDef> = {
  pig: {
    id: 'pig', hostile: false, width: 0.9, height: 0.9, maxHealth: 10,
    walkSpeed: 1.2, runSpeed: 3.4,
    drops: [{ id: 'raw_porkchop', min: 1, max: 2 }],
  },
  sheep: {
    id: 'sheep', hostile: false, width: 0.9, height: 1.2, maxHealth: 8,
    walkSpeed: 1.1, runSpeed: 3.0,
    drops: [{ id: 'wool', min: 1, max: 2 }],
  },
  zombie: {
    id: 'zombie', hostile: true, width: 0.6, height: 1.9, maxHealth: 20,
    walkSpeed: 1.0, runSpeed: 2.6,
    drops: [],
    attackDamage: 3,
  },
};

const GRAVITY = -28;
const JUMP_SPEED = 8.5;

type AiState = 'idle' | 'wander' | 'flee' | 'chase';

export interface MobContext {
  world: ChunkManager;
  playerPos: THREE.Vector3;
  /** True while the sun is up (zombies burn). */
  isDay: boolean;
  /** Called when this mob lands a hit on the player. */
  attackPlayer: (mob: Mob) => void;
}

/** Simple box part of a mob model (for leg/arm swing animation). */
function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  m.position.set(x, y, z);
  return m;
}

/**
 * A mob: boxy model, voxel AABB physics (axis-separated like the player),
 * and a small AI state machine — passive mobs wander and flee when hurt,
 * zombies chase the player with greedy steering plus jumps, attack on
 * contact, and burn in daylight.
 */
export class Mob {
  readonly def: MobTypeDef;
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();
  readonly group: THREE.Group;
  health: number;
  yaw = Math.random() * Math.PI * 2;
  dead = false;
  onGround = false;

  private state: AiState = 'idle';
  private stateTimer = 1 + Math.random() * 3;
  private moveDirX = 0;
  private moveDirZ = 0;
  private hurtFlash = 0;
  private attackCooldown = 0;
  private burnTimer = 0;
  private animTime = 0;
  private readonly legs: THREE.Mesh[] = [];
  private readonly materials: THREE.MeshLambertMaterial[] = [];

  constructor(type: MobTypeId, position: THREE.Vector3) {
    this.def = MOB_TYPES[type];
    this.position = position.clone();
    this.health = this.def.maxHealth;
    this.group = new THREE.Group();
    this.buildModel(type);
    for (const child of this.group.children) {
      const mesh = child as THREE.Mesh;
      this.materials.push(mesh.material as THREE.MeshLambertMaterial);
    }
  }

  private buildModel(type: MobTypeId): void {
    if (type === 'pig' || type === 'sheep') {
      const bodyColor = type === 'pig' ? 0xe89aa2 : 0xe8e4dc;
      const headColor = type === 'pig' ? 0xd9858e : 0xa8a49c;
      const legColor = type === 'pig' ? 0xd9858e : 0x8a867e;
      const bodyY = type === 'pig' ? 0.55 : 0.75;
      this.group.add(box(0.9, 0.55, 0.55, bodyColor, 0, bodyY, 0));        // body
      this.group.add(box(0.45, 0.45, 0.45, headColor, 0, bodyY + 0.1, -0.6)); // head
      for (const [lx, lz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
        const leg = box(0.18, bodyY - 0.27, 0.18, legColor, lx, (bodyY - 0.27) / 2, lz);
        this.legs.push(leg);
        this.group.add(leg);
      }
    } else {
      // Zombie: green humanoid.
      this.group.add(box(0.5, 0.7, 0.28, 0x4a8a3a, 0, 1.05, 0));            // torso
      this.group.add(box(0.45, 0.45, 0.45, 0x5aa04a, 0, 1.65, 0));          // head
      const armL = box(0.16, 0.65, 0.16, 0x4a8a3a, -0.34, 1.2, -0.2);       // arms forward
      const armR = box(0.16, 0.65, 0.16, 0x4a8a3a, 0.34, 1.2, -0.2);
      armL.rotation.x = armR.rotation.x = -Math.PI / 2.4;
      this.group.add(armL, armR);
      for (const lx of [-0.13, 0.13]) {
        const leg = box(0.2, 0.7, 0.2, 0x3a6a52, lx, 0.35, 0);
        this.legs.push(leg);
        this.group.add(leg);
      }
    }
  }

  /** Damage with knockback away from `from`; returns true if it died. */
  hurt(amount: number, from?: THREE.Vector3): boolean {
    if (this.dead) return false;
    this.health -= amount;
    this.hurtFlash = 0.35;
    if (from) {
      const dx = this.position.x - from.x;
      const dz = this.position.z - from.z;
      const len = Math.hypot(dx, dz) || 1;
      this.velocity.x += (dx / len) * 7;
      this.velocity.z += (dz / len) * 7;
      if (this.onGround) this.velocity.y = 5;
    }
    // Passive mobs panic when hit.
    if (!this.def.hostile) {
      this.state = 'flee';
      this.stateTimer = 5;
    }
    if (this.health <= 0) this.dead = true;
    return this.dead;
  }

  update(dt: number, ctx: MobContext): void {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.think(dt, ctx);

    // --- Physics ---
    const speed = this.state === 'flee' || this.state === 'chase' ? this.def.runSpeed : this.def.walkSpeed;
    const moving = this.state === 'wander' || this.state === 'flee' || this.state === 'chase';
    const targetVx = moving ? this.moveDirX * speed : 0;
    const targetVz = moving ? this.moveDirZ * speed : 0;
    // Smooth horizontal control, keeps knockback impulses visible.
    this.velocity.x += (targetVx - this.velocity.x) * Math.min(1, 8 * dt);
    this.velocity.z += (targetVz - this.velocity.z) * Math.min(1, 8 * dt);
    this.velocity.y += GRAVITY * dt;
    if (this.velocity.y < -50) this.velocity.y = -50;

    const blockedX = this.moveAxis(0, this.velocity.x * dt, ctx.world);
    this.onGround = false;
    this.moveAxis(1, this.velocity.y * dt, ctx.world);
    const blockedZ = this.moveAxis(2, this.velocity.z * dt, ctx.world);

    // Step up single blocks by jumping when walking into a wall.
    if (moving && (blockedX || blockedZ) && this.onGround) {
      this.velocity.y = JUMP_SPEED * 0.85;
    }

    if (this.position.y < -16) this.dead = true;

    // --- Zombie daylight burn (when no roof overhead) ---
    if (this.def.hostile && ctx.isDay) {
      this.burnTimer += dt;
      if (this.burnTimer >= 1) {
        this.burnTimer = 0;
        if (!this.hasRoof(ctx.world)) this.hurt(2);
      }
    }

    // --- Visuals ---
    if (moving) this.animTime += dt * speed * 3;
    const swing = Math.sin(this.animTime) * 0.6;
    for (let i = 0; i < this.legs.length; i++) {
      this.legs[i].rotation.x = i % 2 === 0 ? swing : -swing;
    }
    // Red emissive flash while recently hurt.
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    const red = this.hurtFlash > 0 ? 0.45 + this.hurtFlash * 0.5 : 0;
    for (const m of this.materials) m.emissive.setRGB(red, 0, 0);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
  }

  private think(dt: number, ctx: MobContext): void {
    this.stateTimer -= dt;
    const toPlayer = new THREE.Vector3().subVectors(ctx.playerPos, this.position);
    const distToPlayer = toPlayer.length();

    if (this.def.hostile) {
      // Zombie: chase when the player is close, attack on contact.
      if (distToPlayer < 18) {
        this.state = 'chase';
        this.moveDirX = toPlayer.x / (distToPlayer || 1);
        this.moveDirZ = toPlayer.z / (distToPlayer || 1);
        this.yaw = Math.atan2(-this.moveDirX, -this.moveDirZ);
        if (distToPlayer < 1.6 && this.attackCooldown === 0) {
          this.attackCooldown = 1.1;
          ctx.attackPlayer(this);
        }
        return;
      }
      this.state = 'idle';
      return;
    }

    // Passive: idle ↔ wander, flee overrides.
    if (this.state === 'flee') {
      if (this.stateTimer <= 0) this.state = 'idle';
      else if (distToPlayer > 0.1) {
        this.moveDirX = -toPlayer.x / distToPlayer;
        this.moveDirZ = -toPlayer.z / distToPlayer;
        this.yaw = Math.atan2(-this.moveDirX, -this.moveDirZ);
      }
      return;
    }
    if (this.stateTimer <= 0) {
      if (this.state === 'idle') {
        this.state = 'wander';
        this.stateTimer = 2 + Math.random() * 3;
        const a = Math.random() * Math.PI * 2;
        this.moveDirX = Math.sin(a);
        this.moveDirZ = Math.cos(a);
        this.yaw = Math.atan2(-this.moveDirX, -this.moveDirZ);
      } else {
        this.state = 'idle';
        this.stateTimer = 1 + Math.random() * 4;
      }
    }
  }

  /** Axis-separated AABB collision (same approach as the player). Returns true if blocked. */
  private moveAxis(axis: 0 | 1 | 2, amount: number, world: ChunkManager): boolean {
    if (amount === 0) return false;
    const p = this.position;
    const coord = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
    p[coord] += amount;

    const half = this.def.width / 2;
    const minX = Math.floor(p.x - half);
    const maxX = Math.floor(p.x + half - 1e-7);
    const minY = Math.floor(p.y);
    const maxY = Math.floor(p.y + this.def.height - 1e-7);
    const minZ = Math.floor(p.z - half);
    const maxZ = Math.floor(p.z + half - 1e-7);

    let hit = false;
    let landed = false;
    let resolved = p[coord];
    for (let by = minY; by <= maxY; by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        for (let bx = minX; bx <= maxX; bx++) {
          if (!isCollidable(world.getBlock(bx, by, bz))) continue;
          hit = true;
          let candidate: number;
          if (axis === 0) candidate = amount > 0 ? bx - half - 1e-6 : bx + 1 + half + 1e-6;
          else if (axis === 1) {
            if (amount > 0) candidate = by - this.def.height - 1e-6;
            else { candidate = by + 1; landed = true; }
          } else candidate = amount > 0 ? bz - half - 1e-6 : bz + 1 + half + 1e-6;
          resolved = amount > 0 ? Math.min(resolved, candidate) : Math.max(resolved, candidate);
        }
      }
    }
    if (hit) {
      p[coord] = resolved;
      if (axis === 1) {
        this.velocity.y = 0;
        if (landed) this.onGround = true;
      }
    }
    return hit && axis !== 1;
  }

  /** Any solid block within 15 above the head? (Shelter from sunlight.) */
  private hasRoof(world: ChunkManager): boolean {
    const x = Math.floor(this.position.x);
    const z = Math.floor(this.position.z);
    const top = Math.floor(this.position.y + this.def.height);
    for (let y = top + 1; y <= top + 15; y++) {
      const id = world.getBlock(x, y, z);
      if (id !== Block.Air && id !== Block.Water) return true;
    }
    return false;
  }

  dispose(): void {
    for (const child of this.group.children) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
