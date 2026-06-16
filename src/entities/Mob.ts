import * as THREE from 'three';
import { ChunkManager } from '../world/ChunkManager';
import { isCollidable, Block } from '../world/BlockRegistry';
import { Trade } from './Trading';

export type MobTypeId = 'pig' | 'sheep' | 'zombie' | 'villager' | 'zombie_pigman' | 'ender_dragon';

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
  /** True if this mob burns in daylight (zombies do; nether mobs don't). */
  burns?: boolean;
  /** True if this mob ignores gravity/vertical collision and hovers (the dragon). */
  flies?: boolean;
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
    burns: true,
  },
  villager: {
    id: 'villager', hostile: false, width: 0.6, height: 1.9, maxHealth: 20,
    walkSpeed: 0.8, runSpeed: 1.4,
    drops: [],
  },
  zombie_pigman: {
    id: 'zombie_pigman', hostile: true, width: 0.6, height: 1.9, maxHealth: 20,
    walkSpeed: 1.0, runSpeed: 2.8,
    drops: [{ id: 'raw_porkchop', min: 0, max: 1 }],
    attackDamage: 4,
  },
  ender_dragon: {
    id: 'ender_dragon', hostile: true, width: 4.5, height: 3, maxHealth: 100,
    walkSpeed: 4, runSpeed: 7,
    drops: [{ id: 'dragon_egg', min: 1, max: 1 }],
    attackDamage: 6,
    flies: true,
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
  /** Which dimension is currently active (drives spawn rules, not physics). */
  dimension: 'overworld' | 'nether' | 'end';
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

/** A small flat eye accent, slightly inset so it doesn't z-fight the face it sits on. */
function eye(x: number, y: number, z: number, color = 0x0a0a0a, glow = false): THREE.Mesh {
  const m = box(0.07, 0.07, 0.03, color, x, y, z);
  if (glow) (m.material as THREE.MeshLambertMaterial).emissive.setHex(color);
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
  /** Villagers only: the trade offers rolled at spawn. */
  trades?: Trade[];
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
  private headTurn = 0;
  private readonly legs: THREE.Mesh[] = [];
  private readonly arms: THREE.Mesh[] = [];
  /** Material + its resting emissive color, so the hurt-flash can restore
   *  rather than overwrite (the dragon's glowing eyes use emissive too). */
  private readonly materials: Array<{ mat: THREE.MeshLambertMaterial; baseEmissive: THREE.Color }> = [];
  /** Holds the head (+ face/horns/nose) so it can turn independently of the body. */
  private readonly head: THREE.Group;

  constructor(type: MobTypeId, position: THREE.Vector3) {
    this.def = MOB_TYPES[type];
    this.position = position.clone();
    this.health = this.def.maxHealth;
    this.group = new THREE.Group();
    this.head = new THREE.Group();
    this.buildModel(type);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshLambertMaterial;
        this.materials.push({ mat, baseEmissive: mat.emissive.clone() });
      }
    });
  }

  /** Position the (already-built, head-local) head group at the neck and attach it. */
  private mountHead(x: number, y: number, z: number): void {
    this.head.position.set(x, y, z);
    this.group.add(this.head);
  }

  private buildModel(type: MobTypeId): void {
    if (type === 'pig' || type === 'sheep') {
      const isPig = type === 'pig';
      const bodyColor = isPig ? 0xe89aa2 : 0xcfcac0; // sheep body = darker skin under the wool
      const woolColor = 0xece8e0;
      const headColor = isPig ? 0xd9858e : 0xe0dcd2;
      const legColor = isPig ? 0xc97882 : 0x8a867e;
      const bodyY = isPig ? 0.55 : 0.72;
      this.group.add(box(0.9, 0.55, 0.55, bodyColor, 0, bodyY, 0)); // body
      if (!isPig) {
        // Puffy wool overlay, slightly larger than the body underneath.
        this.group.add(box(1.0, 0.62, 0.62, woolColor, 0, bodyY + 0.02, 0));
      }
      // Head + snout/eyes, mounted as an independently-turning group.
      this.head.add(box(0.45, 0.42, 0.42, headColor, 0, 0, 0));
      if (isPig) {
        this.head.add(box(0.22, 0.16, 0.1, 0xc97882, 0, -0.04, -0.26)); // snout
        this.head.add(eye(-0.13, 0.07, -0.2), eye(0.13, 0.07, -0.2));
      } else {
        this.head.add(box(0.5, 0.46, 0.46, woolColor, 0, 0.03, 0.02)); // wool cap on the head
        this.head.add(eye(-0.13, 0.04, -0.22), eye(0.13, 0.04, -0.22));
      }
      // Ears: small angled flaps either side of the head.
      const earL = box(0.05, 0.14, 0.16, headColor, -0.23, 0.16, -0.1);
      const earR = box(0.05, 0.14, 0.16, headColor, 0.23, 0.16, -0.1);
      earL.rotation.z = 0.5; earR.rotation.z = -0.5;
      this.head.add(earL, earR);
      this.mountHead(0, bodyY + 0.1, -0.6);
      // Curly tail.
      const tail = box(0.08, 0.08, 0.2, legColor, 0, bodyY + 0.05, 0.62);
      tail.rotation.x = 0.6;
      this.group.add(tail);
      for (const [lx, lz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
        const leg = box(0.18, bodyY - 0.27, 0.18, legColor, lx, (bodyY - 0.27) / 2, lz);
        this.legs.push(leg);
        this.group.add(leg);
      }
    } else if (type === 'zombie' || type === 'zombie_pigman') {
      const isPigman = type === 'zombie_pigman';
      const skin = isPigman ? 0xd98a93 : 0x4a8a3a;
      const headSkin = isPigman ? 0xe6a3ab : 0x5aa04a;
      const limbSkin = isPigman ? 0xc77881 : 0x3a6a52;
      const tornShirt = isPigman ? 0xa3677a : 0x2f5a30; // darker torso accent for a tattered look
      this.group.add(box(0.5, 0.7, 0.28, skin, 0, 1.05, 0));                 // torso
      this.group.add(box(0.5, 0.22, 0.05, tornShirt, 0, 0.78, 0.15));        // tattered hem
      this.head.add(box(0.45, 0.45, 0.45, headSkin, 0, 0, 0));
      this.head.add(eye(-0.12, 0.04, -0.225, 0x140404), eye(0.12, 0.04, -0.225, 0x140404));
      this.mountHead(0, 1.65, 0);
      const armL = box(0.16, 0.65, 0.16, skin, -0.34, 1.2, -0.2);            // arms forward (iconic zombie pose)
      const armR = box(0.16, 0.65, 0.16, skin, 0.34, 1.2, -0.2);
      armL.rotation.x = armR.rotation.x = -Math.PI / 2.4;
      // Arms stay in the rigid forward reach (not added to this.arms — that
      // pose is the iconic zombie silhouette, not meant to swing like a walk).
      this.group.add(armL, armR);
      for (const lx of [-0.13, 0.13]) {
        const leg = box(0.2, 0.7, 0.2, limbSkin, lx, 0.35, 0);
        this.legs.push(leg);
        this.group.add(leg);
      }
    } else if (type === 'ender_dragon') {
      // Ender Dragon: large black-purple body, flat tapered wings, horned
      // head with glowing eyes, clawed legs, and a long tail.
      this.group.add(box(2.2, 1.1, 3.6, 0x1d1124, 0, 1.8, 0));               // body
      this.group.add(box(1.0, 0.5, 1.0, 0x150d1c, 0, 1.1, -2.0));            // chest plate ridge
      this.head.add(box(1.0, 0.9, 1.4, 0x2a1a36, 0, 0, 0));
      this.head.add(box(0.18, 0.18, 0.5, 0x120a18, -0.3, 0.4, -0.6));        // horn L
      this.head.add(box(0.18, 0.18, 0.5, 0x120a18, 0.3, 0.4, -0.6));         // horn R
      this.head.add(eye(-0.28, 0.05, -0.65, 0x9a4dff, true), eye(0.28, 0.05, -0.65, 0x9a4dff, true));
      this.mountHead(0, 1.9, -2.4);
      const wingL = box(3.4, 0.18, 2.0, 0x2a1a36, -2.6, 2.1, 0);
      const wingR = box(3.4, 0.18, 2.0, 0x2a1a36, 2.6, 2.1, 0);
      const wingTipL = box(1.6, 0.14, 1.1, 0x150d1c, -4.4, 2.1, 0.3);
      const wingTipR = box(1.6, 0.14, 1.1, 0x150d1c, 4.4, 2.1, 0.3);
      this.group.add(wingL, wingR, wingTipL, wingTipR);
      this.legs.push(wingL, wingR); // reuse the swing animation as a wing flap
      this.group.add(box(0.5, 0.5, 2.4, 0x1d1124, 0, 1.6, 2.6));             // tail
      this.group.add(box(0.3, 0.3, 0.6, 0x1d1124, 0, 1.3, 3.7));             // tail tip
      for (const [lx, lz] of [[-0.7, -1.0], [0.7, -1.0], [-0.7, 1.0], [0.7, 1.0]]) {
        this.group.add(box(0.4, 1.0, 0.4, 0x1d1124, lx, 0.5, lz));           // legs
        this.group.add(box(0.5, 0.18, 0.6, 0x120a18, lx, 0.02, lz - 0.1));   // clawed feet
      }
    } else {
      // Villager: brown-robed humanoid with a tan head, simple eyes, and a
      // long nose bump.
      this.group.add(box(0.5, 0.8, 0.28, 0x6b4f3a, 0, 1.1, 0));             // robe/torso
      this.group.add(box(0.52, 0.16, 0.3, 0x5a4030, 0, 0.74, 0));           // apron hem
      this.head.add(box(0.45, 0.45, 0.45, 0xe0c19a, 0, 0, 0));
      this.head.add(box(0.1, 0.16, 0.12, 0xd1a878, 0, -0.05, -0.27));       // nose
      this.head.add(eye(-0.12, 0.03, -0.22), eye(0.12, 0.03, -0.22));
      this.mountHead(0, 1.65, 0);
      const armL = box(0.16, 0.6, 0.16, 0x6b4f3a, -0.33, 1.2, 0);
      const armR = box(0.16, 0.6, 0.16, 0x6b4f3a, 0.33, 1.2, 0);
      this.arms.push(armL, armR);
      this.group.add(armL, armR);
      for (const lx of [-0.13, 0.13]) {
        const leg = box(0.2, 0.55, 0.2, 0x4a4038, lx, 0.275, 0);
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
    if (this.def.flies) {
      // Hover a few blocks above the player instead of falling.
      const desiredY = ctx.playerPos.y + 5;
      this.velocity.y = (desiredY - this.position.y) * 1.5;
    } else {
      this.velocity.y += GRAVITY * dt;
      if (this.velocity.y < -50) this.velocity.y = -50;
    }

    const blockedX = this.moveAxis(0, this.velocity.x * dt, ctx.world);
    this.onGround = false;
    this.moveAxis(1, this.velocity.y * dt, ctx.world);
    const blockedZ = this.moveAxis(2, this.velocity.z * dt, ctx.world);

    // Step up single blocks by jumping when walking into a wall.
    if (moving && (blockedX || blockedZ) && this.onGround && !this.def.flies) {
      this.velocity.y = JUMP_SPEED * 0.85;
    }

    if (this.position.y < -16) this.dead = true;

    // --- Zombie daylight burn (when no roof overhead) ---
    if (this.def.hostile && this.def.burns && ctx.isDay) {
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
    // Arms (villager only — the zombie/pigman forward reach stays rigid)
    // swing opposite the legs, like a natural walk.
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].rotation.x = (i % 2 === 0 ? -swing : swing) * 0.5;
    }

    // Head tracking: while idle (not moving/chasing/fleeing), slowly turn to
    // glance at a nearby player — classic Minecraft mob behavior. Clamped so
    // it never twists unnaturally far, and relaxes back to forward otherwise.
    let targetHeadYaw = 0;
    if (this.state === 'idle') {
      const dx = ctx.playerPos.x - this.position.x;
      const dz = ctx.playerPos.z - this.position.z;
      const distH = Math.hypot(dx, dz);
      if (distH > 0.5 && distH < 10) {
        const angleToPlayer = Math.atan2(-dx, -dz);
        const diff = Math.atan2(Math.sin(angleToPlayer - this.yaw), Math.cos(angleToPlayer - this.yaw));
        targetHeadYaw = Math.max(-1.05, Math.min(1.05, diff));
      }
    }
    this.headTurn += (targetHeadYaw - this.headTurn) * Math.min(1, 5 * dt);
    this.head.rotation.y = this.headTurn;

    // Red emissive flash while recently hurt; otherwise rest at each
    // material's own base emissive (so glowing eyes etc. aren't erased).
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.hurtFlash > 0) {
      const red = 0.45 + this.hurtFlash * 0.5;
      for (const { mat } of this.materials) mat.emissive.setRGB(red, 0, 0);
    } else {
      for (const { mat, baseEmissive } of this.materials) mat.emissive.copy(baseEmissive);
    }
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
  }

  private think(dt: number, ctx: MobContext): void {
    this.stateTimer -= dt;
    const toPlayer = new THREE.Vector3().subVectors(ctx.playerPos, this.position);
    const distToPlayer = toPlayer.length();

    if (this.def.hostile) {
      // Zombie/pigman/dragon: chase when the player is close, attack on contact.
      // Flying mobs (the dragon) get a much longer aggro range — it's a boss fight.
      const aggroRange = this.def.flies ? 60 : 18;
      const reach = 1.6 + this.def.width / 2;
      if (distToPlayer < aggroRange) {
        this.state = 'chase';
        const horizLen = Math.hypot(toPlayer.x, toPlayer.z) || 1;
        this.moveDirX = toPlayer.x / horizLen;
        this.moveDirZ = toPlayer.z / horizLen;
        this.yaw = Math.atan2(-this.moveDirX, -this.moveDirZ);
        if (distToPlayer < reach && this.attackCooldown === 0) {
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
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }
}
