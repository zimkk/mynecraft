import * as THREE from 'three';
import { Mob, MobTypeId, MobContext } from './Mob';
import { EntityManager } from './EntityManager';
import { ChunkManager } from '../world/ChunkManager';
import { isCollidable } from '../world/BlockRegistry';
import { makeStack, itemDef } from '../items/ItemRegistry';

const MOB_CAP_HOSTILE = 10;
const MOB_CAP_PASSIVE = 8;
const SPAWN_INTERVAL_S = 2;
const SPAWN_MIN_DIST = 20;
const SPAWN_MAX_DIST = 44;
const DESPAWN_DIST = 80;

/**
 * Owns all mobs: spawn attempts on a timer (hostiles at night, passives in
 * daylight, both capped and ring-distanced from the player), per-frame AI +
 * physics updates, melee hit testing, and death drops. Mobs are not saved —
 * the world repopulates on load.
 */
export class MobManager {
  readonly mobs: Mob[] = [];
  private readonly scene: THREE.Scene;
  private readonly world: ChunkManager;
  private readonly entities: EntityManager;
  private spawnTimer = 0;

  constructor(scene: THREE.Scene, world: ChunkManager, entities: EntityManager) {
    this.scene = scene;
    this.world = world;
    this.entities = entities;
  }

  update(dt: number, ctx: Omit<MobContext, 'world'>): void {
    const fullCtx: MobContext = { ...ctx, world: this.world };

    this.spawnTimer += dt;
    if (this.spawnTimer >= SPAWN_INTERVAL_S) {
      this.spawnTimer = 0;
      this.trySpawn(ctx.playerPos, ctx.isDay);
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      mob.update(dt, fullCtx);

      const dist = mob.position.distanceTo(ctx.playerPos);
      if (dist > DESPAWN_DIST) mob.dead = true;

      if (mob.dead) {
        this.dropLoot(mob);
        this.scene.remove(mob.group);
        mob.dispose();
        this.mobs.splice(i, 1);
      }
    }
  }

  /** One spawn attempt: random ring position around the player at surface height. */
  private trySpawn(playerPos: THREE.Vector3, isDay: boolean): void {
    const hostiles = this.mobs.filter((m) => m.def.hostile).length;
    const passives = this.mobs.length - hostiles;

    let type: MobTypeId | null = null;
    if (!isDay && hostiles < MOB_CAP_HOSTILE) {
      type = 'zombie';
    } else if (isDay && passives < MOB_CAP_PASSIVE && Math.random() < 0.4) {
      type = Math.random() < 0.5 ? 'pig' : 'sheep';
    }
    if (!type) return;

    const angle = Math.random() * Math.PI * 2;
    const dist = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
    const x = Math.floor(playerPos.x + Math.cos(angle) * dist);
    const z = Math.floor(playerPos.z + Math.sin(angle) * dist);

    // Find the surface: first solid block scanning down from build height.
    let y = 90;
    while (y > 1 && !isCollidable(this.world.getBlock(x, y - 1, z))) y--;
    if (y <= 1 || y > 80) return; // unloaded column or silly height
    // Don't spawn in water.
    if (this.world.getBlock(x, y, z) !== 0) return;

    this.spawn(type, new THREE.Vector3(x + 0.5, y, z + 0.5));
  }

  spawn(type: MobTypeId, position: THREE.Vector3): Mob {
    const mob = new Mob(type, position);
    this.mobs.push(mob);
    this.scene.add(mob.group);
    return mob;
  }

  private dropLoot(mob: Mob): void {
    for (const drop of mob.def.drops) {
      const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
      if (count > 0 && itemDef(drop.id)) {
        this.entities.dropItem(
          makeStack(drop.id, count),
          mob.position.clone().add(new THREE.Vector3(0, mob.def.height / 2, 0)),
        );
      }
    }
  }

  /**
   * Melee hit test: march along the look ray and return the first mob whose
   * AABB contains the sample point (cheap, good enough at 3.5-block reach).
   */
  raycastMob(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): Mob | null {
    for (let t = 0.3; t <= maxDist; t += 0.25) {
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      for (const mob of this.mobs) {
        const half = mob.def.width / 2 + 0.1;
        if (
          px > mob.position.x - half && px < mob.position.x + half &&
          py > mob.position.y - 0.1 && py < mob.position.y + mob.def.height + 0.1 &&
          pz > mob.position.z - half && pz < mob.position.z + half
        ) {
          return mob;
        }
      }
    }
    return null;
  }

  get count(): number {
    return this.mobs.length;
  }
}
